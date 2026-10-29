use std::collections::HashMap;
use std::sync::RwLock;
use std::time::Instant;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct CacheKey {
    pub layer_id: String,
    pub band_id: String,
    pub start: u64,
    pub end: u64,
}

#[derive(Clone)]
pub struct CachedChunk {
    pub data: Vec<u8>,
    pub total_length: u64,
    pub last_accessed: Instant,
}

pub struct ByteRangeCache {
    entries: RwLock<HashMap<CacheKey, CachedChunk>>,
    max_bytes: usize,
    max_entries: usize,
}

impl ByteRangeCache {
    pub fn new(max_bytes: usize, max_entries: usize) -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
            max_bytes,
            max_entries,
        }
    }

    pub fn get(
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

        let mut map = self.entries.write().ok()?;
        if let Some(entry) = map.get_mut(&key) {
            entry.last_accessed = Instant::now();
            Some((entry.data.clone(), entry.total_length))
        } else {
            None
        }
    }

    pub fn put(
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

        let mut map = match self.entries.write() {
            Ok(guard) => guard,
            Err(_) => return,
        };

        // If single chunk exceeds half max_bytes, don't overwhelm cache
        if data.len() > self.max_bytes / 2 {
            return;
        }

        let chunk_size = data.len();

        // Evict until under budget
        while (map.len() >= self.max_entries
            || map.values().map(|v| v.data.len()).sum::<usize>() + chunk_size > self.max_bytes)
            && !map.is_empty()
        {
            // Find oldest key
            let oldest_key = map
                .iter()
                .min_by_key(|(_, v)| v.last_accessed)
                .map(|(k, _)| k.clone());

            if let Some(k) = oldest_key {
                map.remove(&k);
            } else {
                break;
            }
        }

        map.insert(
            key,
            CachedChunk {
                data,
                total_length,
                last_accessed: Instant::now(),
            },
        );
    }

    pub fn len(&self) -> usize {
        self.entries.read().map(|m| m.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn clear(&self) {
        if let Ok(mut m) = self.entries.write() {
            m.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_byte_range_cache_basic_put_get() {
        let cache = ByteRangeCache::new(1024 * 1024, 100);
        cache.put(
            "layer_1".into(),
            "B04".into(),
            0,
            1023,
            vec![1, 2, 3, 4],
            5000,
        );

        let hit = cache.get("layer_1", "B04", 0, 1023);
        assert!(hit.is_some());
        let (bytes, total) = hit.unwrap();
        assert_eq!(bytes, vec![1, 2, 3, 4]);
        assert_eq!(total, 5000);

        let miss = cache.get("layer_1", "B04", 1024, 2047);
        assert!(miss.is_none());
    }

    #[test]
    fn test_byte_range_cache_eviction() {
        let cache = ByteRangeCache::new(20, 2);
        cache.put("l".into(), "b1".into(), 0, 4, vec![0; 5], 100);
        cache.put("l".into(), "b2".into(), 0, 4, vec![1; 5], 100);
        assert_eq!(cache.len(), 2);

        // Access b1 to refresh its last_accessed
        assert!(cache.get("l", "b1", 0, 4).is_some());

        // Insert b3 -> b2 should be evicted because b1 was recently accessed
        cache.put("l".into(), "b3".into(), 0, 4, vec![2; 5], 100);
        assert_eq!(cache.len(), 2);

        assert!(cache.get("l", "b1", 0, 4).is_some());
        assert!(cache.get("l", "b2", 0, 4).is_none());
        assert!(cache.get("l", "b3", 0, 4).is_some());
    }
}
