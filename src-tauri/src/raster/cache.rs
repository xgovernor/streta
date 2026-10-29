use moka::future::Cache;
use std::sync::Arc;
use std::time::Duration;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct CacheKey {
    pub layer_id: String,
    pub band_id: String,
    pub start: u64,
    pub end: u64,
}

#[derive(Clone)]
pub struct CachedChunk {
    pub data: Arc<Vec<u8>>,
    pub total_length: u64,
}

pub struct ByteRangeCache {
    inner: Cache<CacheKey, CachedChunk>,
}

impl ByteRangeCache {
    pub fn new(max_bytes: u64, max_entries: u64) -> Self {
        let inner = Cache::builder()
            .max_capacity(max_bytes)
            .weigher(|_key, chunk: &CachedChunk| -> u32 {
                (chunk.data.len() as u32).clamp(1, u32::MAX)
            })
            .initial_capacity((max_entries / 4).max(1) as usize)
            .time_to_idle(Duration::from_secs(7200))
            .support_invalidation_closures()
            .build();

        Self { inner }
    }

    pub async fn get(
        &self,
        layer_id: &str,
        band_id: &str,
        start: u64,
        end: u64,
    ) -> Option<(Vec<u8>, u64)> {
        let key = CacheKey {
            layer_id: layer_id.to_string(),
            band_id: band_id.to_string(),
            start,
            end,
        };

        self.inner
            .get(&key)
            .await
            .map(|chunk| ((*chunk.data).clone(), chunk.total_length))
    }

    pub async fn put(
        &self,
        layer_id: String,
        band_id: String,
        start: u64,
        end: u64,
        data: Vec<u8>,
        total_length: u64,
    ) {
        let key = CacheKey {
            layer_id,
            band_id,
            start,
            end,
        };

        self.inner
            .insert(
                key,
                CachedChunk {
                    data: Arc::new(data),
                    total_length,
                },
            )
            .await;
    }

    /// Fetches an entry with automatic in-flight request coalescing (singleflight).
    /// If multiple concurrent calls request the same key, only one fetcher future runs.
    pub async fn get_or_fetch<Fut>(
        &self,
        layer_id: &str,
        band_id: &str,
        start: u64,
        end: u64,
        fetcher: Fut,
    ) -> Result<(Vec<u8>, u64), String>
    where
        Fut: std::future::Future<Output = Result<(Vec<u8>, u64), String>>,
    {
        let key = CacheKey {
            layer_id: layer_id.to_string(),
            band_id: band_id.to_string(),
            start,
            end,
        };

        let chunk = self
            .inner
            .try_get_with(key, async move {
                let (bytes, total) = fetcher.await?;
                Ok(CachedChunk {
                    data: Arc::new(bytes),
                    total_length: total,
                })
            })
            .await
            .map_err(|arc_err: Arc<String>| (*arc_err).clone())?;

        Ok(((*chunk.data).clone(), chunk.total_length))
    }

    /// Selectively purges all cached chunks belonging to a single layer.
    pub fn invalidate_layer(&self, layer_id: &str) {
        let id = layer_id.to_string();
        let _ = self.inner.invalidate_entries_if(move |k, _| k.layer_id == id);
    }

    pub async fn run_pending_tasks(&self) {
        self.inner.run_pending_tasks().await;
    }

    pub fn len(&self) -> u64 {
        self.inner.entry_count()
    }

    pub fn current_bytes(&self) -> u64 {
        self.inner.weighted_size()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn clear(&self) {
        self.inner.invalidate_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_byte_range_cache_basic_put_get() {
        let cache = ByteRangeCache::new(1024 * 1024, 100);
        cache
            .put(
                "layer_1".into(),
                "B04".into(),
                0,
                1023,
                vec![1, 2, 3, 4],
                5000,
            )
            .await;

        let hit = cache.get("layer_1", "B04", 0, 1023).await;
        assert!(hit.is_some());
        let (bytes, total) = hit.unwrap();
        assert_eq!(bytes, vec![1, 2, 3, 4]);
        assert_eq!(total, 5000);

        let miss = cache.get("layer_1", "B04", 1024, 2047).await;
        assert!(miss.is_none());
    }

    #[tokio::test]
    async fn test_byte_range_cache_eviction() {
        // Cache with max capacity 100 bytes weight
        let cache = ByteRangeCache::new(100, 100);
        // Insert 15 chunks of 10 bytes each = 150 bytes total > 100 capacity
        for i in 0..15 {
            cache
                .put("l".into(), format!("b{}", i), 0, 9, vec![0; 10], 100)
                .await;
        }
        cache.run_pending_tasks().await;

        // Weighted capacity limit must be respected
        assert!(cache.current_bytes() <= 100);
        assert!(cache.len() <= 10);
    }

    #[tokio::test]
    async fn test_byte_range_cache_invalidate_layer() {
        let cache = ByteRangeCache::new(1024 * 1024, 100);
        cache
            .put("layer_a".into(), "b1".into(), 0, 10, vec![1; 10], 100)
            .await;
        cache
            .put("layer_b".into(), "b1".into(), 0, 10, vec![2; 10], 100)
            .await;

        assert!(cache.get("layer_a", "b1", 0, 10).await.is_some());
        assert!(cache.get("layer_b", "b1", 0, 10).await.is_some());

        cache.invalidate_layer("layer_a");
        cache.run_pending_tasks().await;

        assert!(cache.get("layer_a", "b1", 0, 10).await.is_none());
        assert!(cache.get("layer_b", "b1", 0, 10).await.is_some());
    }

    #[tokio::test]
    async fn test_byte_range_cache_get_or_fetch() {
        let cache = ByteRangeCache::new(1024 * 1024, 100);
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));

        let calls_clone = calls.clone();
        let (data1, total1) = cache
            .get_or_fetch("l", "b", 0, 100, async move {
                calls_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok((vec![42u8; 10], 500u64))
            })
            .await
            .unwrap();

        assert_eq!(data1, vec![42u8; 10]);
        assert_eq!(total1, 500);
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);

        // Second call hits cache; fetcher future is not polled
        let calls_clone2 = calls.clone();
        let (data2, total2) = cache
            .get_or_fetch("l", "b", 0, 100, async move {
                calls_clone2.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok((vec![99u8; 10], 500u64))
            })
            .await
            .unwrap();

        assert_eq!(data2, vec![42u8; 10]);
        assert_eq!(total2, 500);
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
}
