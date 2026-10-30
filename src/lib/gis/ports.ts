/**
 * Curated world seaport gazetteer for AIS voyage-route resolution.
 *
 * AIS broadcasts the destination as a free-text field — typically a port name
 * ("ROTTERDAM") or a UN/LOCODE without separators ("NLRTM", "CNSHA"), often
 * truncated to 16 characters and decorated with anchorage notes. This table
 * carries the world's major commercial seaports with their common AIS spellings
 * so a destination string can resolve to map coordinates. Unknown strings
 * resolve to null: no voyage line is drawn rather than guessing.
 *
 * Coordinates are harbor/anchorage entrance anchors, not city centroids.
 */

export interface PortRecord {
  /** Primary display name. */
  name: string;
  /** UN/LOCODE country + location, without the separator (AIS style). */
  locode: string;
  lon: number;
  lat: number;
  /** Additional AIS-style spellings that should resolve to this port. */
  aliases?: string[];
}

export const PORTS: PortRecord[] = [
  // ── Northwest Europe ──
  { name: "Rotterdam", locode: "NLRTM", lon: 4.1, lat: 51.95, aliases: ["MAASVLAKTE", "EUROPOORT"] },
  { name: "Antwerp", locode: "BEANR", lon: 4.32, lat: 51.25, aliases: ["ANVERS"] },
  { name: "Hamburg", locode: "DEHAM", lon: 9.93, lat: 53.53 },
  { name: "Bremen", locode: "DEBRV", lon: 8.78, lat: 53.1, aliases: ["BREMERHAVEN"] },
  { name: "Wilhelmshaven", locode: "DEWIL", lon: 8.11, lat: 53.52 },
  { name: "Amsterdam", locode: "NLAMS", lon: 4.58, lat: 52.4, aliases: ["IJMUIDEN"] },
  { name: "Le Havre", locode: "FRLEH", lon: 0.11, lat: 49.49, aliases: ["HAVRE"] },
  { name: "Dunkirk", locode: "FRDKK", lon: 2.37, lat: 51.03, aliases: ["DUNKERQUE"] },
  { name: "Zeebrugge", locode: "BEZEE", lon: 3.19, lat: 51.33 },
  { name: "Ghent", locode: "BEGNE", lon: 3.72, lat: 51.05 },
  { name: "Vlissingen", locode: "NLVLI", lon: 3.6, lat: 51.44, aliases: ["FLUSHING"] },
  { name: "Gdansk", locode: "PLGDN", lon: 18.66, lat: 54.37 },
  { name: "Gdynia", locode: "PLGDY", lon: 18.55, lat: 54.53 },
  { name: "Rostock", locode: "DEROS", lon: 12.14, lat: 54.09 },
  { name: "Kiel", locode: "DEKEL", lon: 10.13, lat: 54.32 },
  { name: "Travemunde", locode: "DETSV", lon: 10.87, lat: 53.96, aliases: ["LUBECK", "TRAVEMÜNDE"] },
  { name: "Gothenburg", locode: "SEGOT", lon: 11.79, lat: 57.7, aliases: ["GOTHENBURG", "GOTEBORG"] },
  { name: "Malmo", locode: "SEMMO", lon: 12.97, lat: 55.61 },
  { name: "Stockholm", locode: "SESTO", lon: 18.08, lat: 59.33 },
  { name: "Helsinki", locode: "FIHEL", lon: 24.96, lat: 60.16 },
  { name: "Kotka", locode: "FIKTK", lon: 26.9, lat: 60.47 },
  { name: "Klaipeda", locode: "LTKLA", lon: 21.13, lat: 55.71 },
  { name: "Riga", locode: "LVRIX", lon: 24.11, lat: 57.05 },
  { name: "Tallinn", locode: "EETLL", lon: 24.75, lat: 59.44, aliases: ["MUUGA"] },
  { name: "St Petersburg", locode: "RULED", lon: 30.23, lat: 59.94, aliases: ["SAINT PETERSBURG", "SANKT PETERBURG", "BRONKA"] },
  { name: "Aarhus", locode: "DKAAR", lon: 10.22, lat: 56.15 },
  { name: "Copenhagen", locode: "DKCPH", lon: 12.61, lat: 55.68 },
  { name: "Oslo", locode: "NOOSL", lon: 10.73, lat: 59.91 },
  { name: "Bergen", locode: "NOBGN", lon: 5.32, lat: 60.39 },
  { name: "Dundee", locode: "GBDDE", lon: -2.97, lat: 56.47 },
  { name: "Grangemouth", locode: "GBGEM", lon: -3.73, lat: 56.01 },
  { name: "Teignmouth", locode: "GBTEI", lon: -3.5, lat: 50.54 },

  // ── British Isles ──
  { name: "Felixstowe", locode: "GBFXT", lon: 1.32, lat: 51.95 },
  { name: "London", locode: "GBLON", lon: 0.5, lat: 51.5, aliases: ["LONDON GATEWAY", "THAMESPORT", "TILBURY"] },
  { name: "Southampton", locode: "GBSOU", lon: -1.41, lat: 50.9 },
  { name: "Liverpool", locode: "GBLVP", lon: -3.0, lat: 53.44 },
  { name: "Immingham", locode: "GBIMM", lon: -0.2, lat: 53.62 },
  { name: "Belfast", locode: "GBBFS", lon: -5.9, lat: 54.6 },
  { name: "Dublin", locode: "IEDUB", lon: -6.2, lat: 53.35 },
  { name: "Cork", locode: "IEORK", lon: -8.25, lat: 51.85 },
  { name: "Bilbao", locode: "ESBIO", lon: -3.05, lat: 43.35 },
  { name: "Santander", locode: "ESSDR", lon: -3.79, lat: 43.46 },
  { name: "Gijon", locode: "ESGIJ", lon: -5.66, lat: 43.55, aliases: ["EL MUSEL"] },
  { name: "Vigo", locode: "ESVGO", lon: -8.73, lat: 42.24 },
  { name: "Cartagena", locode: "ESCAR", lon: -1.29, lat: 37.58 },
  { name: "Barcelona", locode: "ESBCN", lon: 2.19, lat: 41.35 },
  { name: "Valencia", locode: "ESVLC", lon: -0.31, lat: 39.46 },
  { name: "Algeciras", locode: "ESALG", lon: -5.44, lat: 36.13 },
  { name: "Tanger Med", locode: "MAPTM", lon: -5.49, lat: 35.89, aliases: ["TANGIER", "TANGIERS", "TANGER"] },
  { name: "Lisbon", locode: "PTLIS", lon: -9.14, lat: 38.72 },
  { name: "Leixoes", locode: "PTLEI", lon: -8.7, lat: 41.24 },
  { name: "Sines", locode: "PTSIE", lon: -8.87, lat: 37.95 },
  { name: "Casablanca", locode: "MACAS", lon: -7.62, lat: 33.6 },
  { name: "Las Palmas", locode: "ESLPA", lon: -15.39, lat: 28.14, aliases: ["GRAN CANARIA"] },
  { name: "Santa Cruz de Tenerife", locode: "ESSCT", lon: -16.2, lat: 28.46, aliases: ["TENERIFE"] },

  // ── Mediterranean, Black Sea ──
  { name: "Marseille", locode: "FRMRS", lon: 5.35, lat: 43.3, aliases: ["FOS", "FOS SUR MER", "MARSEILLE FOS"] },
  { name: "Genoa", locode: "ITGOA", lon: 8.92, lat: 44.4, aliases: ["GENOVA"] },
  { name: "La Spezia", locode: "ITSPE", lon: 9.83, lat: 44.05 },
  { name: "Savona", locode: "ITSVN", lon: 8.5, lat: 44.31 },
  { name: "Civitavecchia", locode: "ITCVV", lon: 11.77, lat: 42.09 },
  { name: "Naples", locode: "ITNAP", lon: 14.27, lat: 40.85, aliases: ["NAPOLI"] },
  { name: "Salerno", locode: "ITSAL", lon: 14.77, lat: 40.67 },
  { name: "Gioia Tauro", locode: "ITGIT", lon: 15.9, lat: 38.43 },
  { name: "Venice", locode: "ITVCE", lon: 12.34, lat: 45.44, aliases: ["VENEZIA", "MARGHERA"] },
  { name: "Trieste", locode: "ITTRS", lon: 13.77, lat: 45.65 },
  { name: "Taranto", locode: "ITTAR", lon: 17.24, lat: 40.47 },
  { name: "Cagliari", locode: "ITCAG", lon: 9.11, lat: 39.2 },
  { name: "Piraeus", locode: "GRPIR", lon: 23.63, lat: 37.94, aliases: ["PIREAUS", "ATHENS", "KERATSINI", "PERAMA"] },
  { name: "Thessaloniki", locode: "GRSKG", lon: 22.94, lat: 40.63 },
  { name: "Ravenna", locode: "ITRAN", lon: 12.27, lat: 44.42 },
  { name: "Igoumenitsa", locode: "GRIGU", lon: 20.5, lat: 39.5 },
  { name: "Constanta", locode: "ROCND", lon: 28.63, lat: 44.18, aliases: ["AGIGEA"] },
  { name: "Istanbul", locode: "TRIST", lon: 28.98, lat: 41.02, aliases: ["HAYDARPASA", "AMBARLI", "BOSPHORUS"] },
  { name: "Gemlik", locode: "TRGEM", lon: 29.16, lat: 40.42 },
  { name: "Izmir", locode: "TRIZM", lon: 27.14, lat: 38.41, aliases: ["ALIAGA"] },
  { name: "Mersin", locode: "TRMER", lon: 34.64, lat: 36.8 },
  { name: "Novorossiysk", locode: "RUNVS", lon: 37.78, lat: 44.7 },
  { name: "Odessa", locode: "UAODS", lon: 30.73, lat: 46.48 },
  { name: "Alexandria", locode: "EGALY", lon: 29.88, lat: 31.2 },
  { name: "Port Said", locode: "EGPSD", lon: 32.31, lat: 31.26 },
  { name: "Suez", locode: "EGSUZ", lon: 32.55, lat: 29.97, aliases: ["SUEZ CANAL", "SUEZ CANAL SOUTH", "SUEZ NORTH"] },

  // ── Red Sea, Persian Gulf, South Asia ──
  { name: "Jeddah", locode: "SAJED", lon: 39.17, lat: 21.54, aliases: ["JEDDAH ISLAMIC PORT", "JEDDAH PORT"] },
  { name: "Djibouti", locode: "DJJIB", lon: 43.15, lat: 11.59 },
  { name: "Salalah", locode: "OMSLL", lon: 54.0, lat: 16.94 },
  { name: "Muscat", locode: "OMMCT", lon: 58.58, lat: 23.62, aliases: ["MINA QABOOS"] },
  { name: "Sohar", locode: "OMSOH", lon: 56.61, lat: 26.38 },
  { name: "Fujairah", locode: "AEFJR", lon: 56.37, lat: 25.13, aliases: ["FUJAIRAH ANCHORAGE", "KHOR FAKKAN", "KHOR FAKKAN ANCH"] },
  { name: "Sharjah", locode: "AESHJ", lon: 55.38, lat: 25.33 },
  { name: "Dubai", locode: "AEDXB", lon: 55.27, lat: 25.26, aliases: ["JEBEL ALI", "MINA RASHID", "JEBEL ALI DXB"] },
  { name: "Abu Dhabi", locode: "AEAUH", lon: 54.53, lat: 24.51, aliases: ["KHALIFA PORT", "MUSAFFAH", "ZAYED PORT"] },
  { name: "Ras Laffan", locode: "QARLA", lon: 51.63, lat: 25.92 },
  { name: "Doha", locode: "QADOH", lon: 51.62, lat: 25.3, aliases: ["HAMAD PORT", "MESAIEED"] },
  { name: "Ras Tanura", locode: "SARTN", lon: 50.15, lat: 26.65, aliases: ["JUBAIL", "JUBAIL PORT"] },
  { name: "Dammam", locode: "SADMM", lon: 50.1, lat: 26.5, aliases: ["AL KHOBAR", "KING ABDUL AZIZ PORT"] },
  { name: "Kuwait", locode: "KWKWI", lon: 48.0, lat: 29.13, aliases: ["SHUWAIKH", "MINA AL AHMADI", "AL AHMADI"] },
  { name: "Bahrain", locode: "BAKBS", lon: 50.63, lat: 26.22, aliases: ["MINA SALMAN", "SITRA"] },
  { name: "Karachi", locode: "PKKHI", lon: 66.99, lat: 24.84, aliases: ["PORT QASIM"] },
  { name: "Mundra", locode: "INMUN", lon: 69.72, lat: 22.74 },
  { name: "Kandla", locode: "INKDL", lon: 70.22, lat: 23.03 },
  { name: "Nhava Sheva", locode: "INNSA", lon: 72.95, lat: 18.95, aliases: ["JAWAHARLAL NEHRU", "JNPT", "BOMBAY", "MUMBAI", "MUNDRA WEST"] },
  { name: "Chennai", locode: "INMAA", lon: 80.3, lat: 13.09, aliases: ["MADRAS"] },
  { name: "Kolkata", locode: "INCCU", lon: 88.11, lat: 22.57, aliases: ["HALDIA"] },
  { name: "Cochin", locode: "INCOK", lon: 76.27, lat: 9.97 },
  { name: "Vizag", locode: "INVTZ", lon: 83.29, lat: 17.69, aliases: ["VISAKHAPATNAM"] },
  { name: "Colombo", locode: "LKCMB", lon: 79.84, lat: 6.94, aliases: ["COLOMBO PORT"] },
  { name: "Chittagong", locode: "BDCGP", lon: 91.8, lat: 22.32 },
  { name: "Chittagong Anchorage", locode: "BDCGP", lon: 91.5, lat: 22.15 },

  // ── East & Southeast Asia ──
  { name: "Shanghai", locode: "CNSHA", lon: 121.49, lat: 31.24, aliases: ["WAIGAOQIAO", "YANGSHAN", "BAOSHAN"] },
  { name: "Ningbo", locode: "CNNGB", lon: 121.55, lat: 29.87, aliases: ["NINGBO ZHOUSHAN", "ZHOUSHAN"] },
  { name: "Shenzhen", locode: "CNSZX", lon: 113.88, lat: 22.51, aliases: ["YANTIAN", "SHEKOU", "CHIWAN", "DACHAN", "MA WAN", "MAWAN"] },
  { name: "Guangzhou", locode: "CNCAN", lon: 113.26, lat: 23.11, aliases: ["HUANGPU", "NANSHA"] },
  { name: "Xiamen", locode: "CNXMN", lon: 118.08, lat: 24.45 },
  { name: "Fuzhou", locode: "CNFOC", lon: 119.3, lat: 25.98 },
  { name: "Qingdao", locode: "CNTAO", lon: 120.38, lat: 36.07 },
  { name: "Tianjin", locode: "CNTSN", lon: 117.75, lat: 38.98, aliases: ["XINGANG", "XIN GANG", "TANGSHAN", "JINGTANG"] },
  { name: "Dalian", locode: "CNDLC", lon: 121.61, lat: 38.92 },
  { name: "Yingkou", locode: "CNYIK", lon: 122.2, lat: 40.67, aliases: ["PANJIN"] },
  { name: "Rizhao", locode: "CNRZH", lon: 119.53, lat: 35.38, aliases: ["LANSCHAN", "LANSHAN"] },
  { name: "Lianyungang", locode: "CNLYG", lon: 119.46, lat: 34.75 },
  { name: "Zhangjiagang", locode: "CNZJG", lon: 120.55, lat: 31.99 },
  { name: "Nantong", locode: "CNNTG", lon: 120.86, lat: 32.01 },
  { name: "Taicang", locode: "CNTAG", lon: 121.11, lat: 31.45 },
  { name: "Zhenjiang", locode: "CNZHE", lon: 119.42, lat: 32.19 },
  { name: "Nanjing", locode: "CNNKG", lon: 118.8, lat: 32.06 },
  { name: "Wuhu", locode: "CNWHU", lon: 118.38, lat: 31.35 },
  { name: "Hong Kong", locode: "HKHKG", lon: 114.13, lat: 22.29, aliases: ["KWAI CHUNG", "KWAI TSING"] },
  { name: "Kaohsiung", locode: "TWKHH", lon: 120.29, lat: 22.6, aliases: ["KAOHSIUNG PORT"] },
  { name: "Taipei", locode: "TWPOS", lon: 121.15, lat: 25.06, aliases: ["KEELUNG", "TAIPEI PORT"] },
  { name: "Taichung", locode: "TWTXG", lon: 120.5, lat: 24.29 },
  { name: "Busan", locode: "KRPUS", lon: 129.04, lat: 35.1, aliases: ["PUSAN", "BUSAN PORT", "BUSAN NEW PORT"] },
  { name: "Incheon", locode: "KRINC", lon: 126.61, lat: 37.46 },
  { name: "Pyeongtaek", locode: "KRPTK", lon: 126.86, lat: 36.99, aliases: ["DANGJIN", "DAESAN"] },
  { name: "Ulsan", locode: "KRUSN", lon: 129.37, lat: 35.5 },
  { name: "Masan", locode: "KRMAS", lon: 128.58, lat: 35.18 },
  { name: "Gwangyang", locode: "KRGWA", lon: 127.79, lat: 34.93, aliases: ["YOSU", "YEOSU"] },
  { name: "Tokyo", locode: "JPTYO", lon: 139.78, lat: 35.62 },
  { name: "Yokohama", locode: "JPYOK", lon: 139.65, lat: 35.44 },
  { name: "Kawasaki", locode: "JPKWS", lon: 139.72, lat: 35.53 },
  { name: "Chiba", locode: "JPCHB", lon: 140.09, lat: 35.6 },
  { name: "Nagoya", locode: "JPNGO", lon: 136.88, lat: 35.08 },
  { name: "Osaka", locode: "JPOSA", lon: 135.43, lat: 34.66 },
  { name: "Kobe", locode: "JPUKB", lon: 135.2, lat: 34.68 },
  { name: "Hakata", locode: "JPHKT", lon: 130.4, lat: 33.6, aliases: ["FUKUOKA"] },
  { name: "Moji", locode: "JPMPJ", lon: 130.96, lat: 33.92, aliases: ["KITAKYUSHU", "KOKURA"] },
  { name: "Manila", locode: "PHMNL", lon: 120.97, lat: 14.6, aliases: ["MANILA SOUTH HARBOR", "MICT", "BATANGAS"] },
  { name: "Cebu", locode: "PHCEB", lon: 123.9, lat: 10.29 },
  { name: "Ho Chi Minh", locode: "VNSGN", lon: 106.77, lat: 10.78, aliases: ["SAIGON", "CAT LAI", "HCMC", "VUNG TAU", "CAI MEP", "CAIMEP"] },
  { name: "Hai Phong", locode: "VNHPH", lon: 106.68, lat: 20.86, aliases: ["LACH HOI"] },
  { name: "Sihanoukville", locode: "KHKOS", lon: 103.52, lat: 10.63, aliases: ["SIHANOUKVILLE PORT"] },
  { name: "Laem Chabang", locode: "THLCH", lon: 100.89, lat: 13.08, aliases: ["LEAM CHABANG", "LEAM CHABENG"] },
  { name: "Bangkok", locode: "THBKK", lon: 100.58, lat: 13.7, aliases: ["KLONG TOEY", "BANGKOK PORT"] },
  { name: "Map Ta Phut", locode: "THMPT", lon: 101.15, lat: 12.66, aliases: ["MAP TA PHUT"] },
  { name: "Singapore", locode: "SGSIN", lon: 103.83, lat: 1.29, aliases: ["SINGAPORE ANCHORAGE", "PSP", "TANJONG PAGAR", "PSA SINGAPORE", "SINGAPORE EAST"] },
  { name: "Port Klang", locode: "MYPKG", lon: 101.39, lat: 3.0, aliases: ["KLANG", "PORT KLANG WEST", "WESTPORT", "NORTHPORT"] },
  { name: "Penang", locode: "MYPEN", lon: 100.34, lat: 5.4, aliases: ["BUTTERWORTH", "PRAI"] },
  { name: "Tanjung Pelepas", locode: "MYTPP", lon: 103.55, lat: 1.36, aliases: ["PELEPAS"] },
  { name: "Kuantan", locode: "MYKUA", lon: 103.32, lat: 3.81 },
  { name: "Jakarta", locode: "IDJKT", lon: 106.86, lat: -6.1, aliases: ["TANJUNG PRIOK", "JKT", "JAKARTA PORT"] },
  { name: "Surabaya", locode: "IDSUB", lon: 112.75, lat: -7.21, aliases: ["TANJUNG PERAK"] },
  { name: "Belawan", locode: "IDBEL", lon: 98.69, lat: 3.77, aliases: ["MEDAN"] },

  // ── Oceania ──
  { name: "Sydney", locode: "AUSYD", lon: 151.19, lat: -33.87, aliases: ["PORT BOTANY"] },
  { name: "Melbourne", locode: "AUMEL", lon: 144.91, lat: -37.84 },
  { name: "Brisbane", locode: "AUBNE", lon: 153.17, lat: -27.36, aliases: ["FISHERMAN ISLANDS"] },
  { name: "Adelaide", locode: "AUADL", lon: 138.5, lat: -34.79, aliases: ["OUTER HARBOR"] },
  { name: "Fremantle", locode: "AUFRE", lon: 115.74, lat: -32.05, aliases: ["PERTH"] },
  { name: "Port Hedland", locode: "AUPHE", lon: 118.58, lat: -20.31, aliases: ["PORT HEDLAND INNER", "UTAH POINT"] },
  { name: "Dampier", locode: "AUDPR", lon: 116.71, lat: -20.66, aliases: ["PORT WALCOTT"] },
  { name: "Karratha", locode: "AUKAR", lon: 116.85, lat: -20.73 },
  { name: "Geraldton", locode: "AUGET", lon: 114.51, lat: -28.77 },
  { name: "Esperance", locode: "AUESP", lon: 121.89, lat: -33.87 },
  { name: "Darwin", locode: "AUDRW", lon: 130.85, lat: -12.44, aliases: ["EAST ARM"] },
  { name: "Auckland", locode: "NZAKL", lon: 174.77, lat: -36.84 },
  { name: "Tauranga", locode: "NZTRG", lon: 176.17, lat: -37.65 },
  { name: "Lyttelton", locode: "NZLTL", lon: 172.72, lat: -43.6 },
  { name: "Wellington", locode: "NZWLG", lon: 174.78, lat: -41.28 },
  { name: "Noumea", locode: "NCNOU", lon: 166.45, lat: -22.27 },
  { name: "Suva", locode: "FJSUV", lon: 178.44, lat: -18.14 },

  // ── North America ──
  { name: "New York", locode: "USNYC", lon: -74.05, lat: 40.66, aliases: ["NEW YORK HARBOR", "NEW YORK NEW JERSEY", "NY NJ", "PORT NEWARK", "ELIZABETH", "STATEN ISLAND", "BROOKLYN"] },
  { name: "Norfolk", locode: "USORF", lon: -76.29, lat: 36.95, aliases: ["NORFOLK PORTS", "VIRGINIA", "NIT", "APM NORFOLK"] },
  { name: "Baltimore", locode: "USBAL", lon: -76.53, lat: 39.28 },
  { name: "Philadelphia", locode: "USPHL", lon: -75.14, lat: 39.95, aliases: ["PAULSBORO"] },
  { name: "Savannah", locode: "USSAV", lon: -81.14, lat: 32.09, aliases: ["GARDEN CITY"] },
  { name: "Charleston", locode: "USCHS", lon: -79.89, lat: 32.79, aliases: ["WANDO WELCH"] },
  { name: "Wilmington NC", locode: "USILG", lon: -77.91, lat: 34.24 },
  { name: "Miami", locode: "USMIA", lon: -80.18, lat: 25.77, aliases: ["DODGE ISLAND"] },
  { name: "Everglades", locode: "USPEF", lon: -80.13, lat: 26.07, aliases: ["PORT EVERGLADES", "FT LAUDERDALE", "FORT LAUDERDALE"] },
  { name: "Tampa", locode: "USTPA", lon: -82.46, lat: 27.94 },
  { name: "New Orleans", locode: "USMSY", lon: -90.06, lat: 29.95, aliases: ["MISSISSIPPI RIVER", "APT"] },
  { name: "Houston", locode: "USHOU", lon: -95.29, lat: 29.73, aliases: ["HOUSTON SHIP CHANNEL", "BAYPORT", "BARBOURS CUT", "TEXAS CITY"] },
  { name: "Corpus Christi", locode: "USCRP", lon: -97.23, lat: 27.8, aliases: ["CORPUS CHRISTI ANCH"] },
  { name: "Beaumont", locode: "USBPT", lon: -97.4, lat: 30.08, aliases: ["PORT ARTHUR", "SABINE", "SABINE PASS"] },
  { name: "Mobile", locode: "USMOB", lon: -88.05, lat: 30.69 },
  { name: "Brownsville", locode: "USBRO", lon: -97.5, lat: 25.95 },
  { name: "Long Beach", locode: "USLGB", lon: -118.2, lat: 33.75, aliases: ["LOS ANGELES", "SAN PEDRO", "PIER T", "PORT OF LOS ANGELES", "LOS ANGELES LONG BEACH"] },
  { name: "Oakland", locode: "USOAK", lon: -122.32, lat: 37.79, aliases: ["SAN FRANCISCO", "SAN FRANCISCO BAY"] },
  { name: "Seattle", locode: "USSEA", lon: -122.34, lat: 47.6, aliases: ["PUGET SOUND", "HARBOR ISLAND"] },
  { name: "Tacoma", locode: "USTIW", lon: -122.43, lat: 47.26 },
  { name: "Portland OR", locode: "USPDX", lon: -122.69, lat: 45.62, aliases: ["COLUMBIA RIVER", "KALAMA", "LONGVIEW"] },
  { name: "Anchorage", locode: "USANC", lon: -149.87, lat: 61.24 },
  { name: "Saint John", locode: "CASJN", lon: -66.19, lat: 45.27, aliases: ["SAINT JOHN NB"] },
  { name: "Halifax", locode: "CAHAL", lon: -63.55, lat: 44.65 },
  { name: "Montreal", locode: "CAMTR", lon: -73.55, lat: 45.5 },
  { name: "Quebec City", locode: "CAQUE", lon: -71.19, lat: 46.82, aliases: ["QUEBEC"] },
  { name: "Toronto", locode: "CATOR", lon: -79.37, lat: 43.64 },

  // ── Central America, Caribbean, South America ──
  { name: "Balboa", locode: "PABLB", lon: -79.56, lat: 8.94, aliases: ["PANAMA CANAL PACIFIC", "PANAMA CITY"] },
  { name: "Colon", locode: "PAONX", lon: -79.92, lat: 9.36, aliases: ["PANAMA CANAL ATLANTIC", "CRISTOBAL", "MITRA", "MANZANILLO PA", "COLON 2000", "BOCAS DEL TORO"] },
  { name: "Cartagena Colombia", locode: "COCTG", lon: -75.51, lat: 10.4, aliases: ["CARTAGENA COLOMBIA", "CARTAGENA CO", "SPRC CARTAGENA", "MANZANILLO DN", "MAZARO"] },
  { name: "Barranquilla", locode: "COBAQ", lon: -74.78, lat: 10.98 },
  { name: "Santa Marta", locode: "COSMR", lon: -74.23, lat: 11.24 },
  { name: "Puerto Cabello", locode: "VEPBL", lon: -68.0, lat: 10.47, aliases: ["LA GUIRA"] },
  { name: "Willemstad", locode: "ANWIL", lon: -68.95, lat: 12.11, aliases: ["CURACAO", "CURAÇAO"] },
  { name: "Aruba", locode: "AWORJ", lon: -70.02, lat: 12.51, aliases: ["ORANJESTAD"] },
  { name: "Kingston", locode: "JMKIN", lon: -76.79, lat: 17.95, aliases: ["KINGSTON JAMAICA"] },
  { name: "Santo Domingo", locode: "DOSDQ", lon: -69.89, lat: 18.45, aliases: ["CAUCEDO", "RIO HAINA"] },
  { name: "San Juan", locode: "PRSJU", lon: -66.1, lat: 18.46 },
  { name: "Freeport", locode: "BSFPO", lon: -78.79, lat: 26.53, aliases: ["FREEPORT BAHAMAS", "GRAND BAHAMA"] },
  { name: "Nassau", locode: "BSNAS", lon: -77.34, lat: 25.08 },
  { name: "Port of Spain", locode: "TTPOS", lon: -61.51, lat: 10.65 },
  { name: "Point Lisas", locode: "TTPLS", lon: -61.48, lat: 10.45 },
  { name: "Bridgetown", locode: "BBBGI", lon: -59.61, lat: 13.1 },
  { name: "Santos", locode: "BRSSZ", lon: -46.31, lat: -23.96 },
  { name: "Rio de Janeiro", locode: "BRRIO", lon: -43.18, lat: -22.89 },
  { name: "Paranagua", locode: "BRPNG", lon: -48.51, lat: -25.51, aliases: ["PARANAGUÁ"] },
  { name: "Itajai", locode: "BRIAJ", lon: -48.66, lat: -26.91, aliases: ["ITAJAÍ", "NAVEGANTES", "PORTONAVE"] },
  { name: "Rio Grande BR", locode: "BRRIG", lon: -52.1, lat: -32.03, aliases: ["RIO GRANDE BRAZIL"] },
  { name: "Salvador", locode: "BRSSA", lon: -38.51, lat: -12.92, aliases: ["ARATU", "ARATU BR"] },
  { name: "Recife", locode: "BRREC", lon: -34.87, lat: -8.06, aliases: ["SUAPE"] },
  { name: "Vitoria", locode: "BRVIX", lon: -40.34, lat: -20.32, aliases: ["TUBARAO", "VITÓRIA", "PONTA UBU", "UBU"] },
  { name: "Buenos Aires", locode: "ARBUE", lon: -58.36, lat: -34.57 },
  { name: "Rosario", locode: "ARROS", lon: -60.7, lat: -32.94, aliases: ["SAN LORENZO", "SAN LORENZO ANCH", "CONCEPCION"] },
  { name: "Montevideo", locode: "UYMVD", lon: -56.22, lat: -34.9 },
  { name: "Callao", locode: "PECLL", lon: -77.15, lat: -12.05, aliases: ["LIMA", "CALLAO PERU", "PATIO"] },
  { name: "San Antonio", locode: "CLSAN", lon: -71.61, lat: -33.59, aliases: ["SAN ANTONIO CHILE", "SAN ANTONIO PT"] },
  { name: "Valparaiso", locode: "CLVAP", lon: -71.63, lat: -33.03 },
  { name: "Iquique", locode: "CLIQQ", lon: -70.19, lat: -20.21 },
  { name: "Antofagasta", locode: "CLANF", lon: -70.64, lat: -23.65 },
  { name: "Guayaquil", locode: "ECGYE", lon: -79.9, lat: -2.2 },
  { name: "Manta", locode: "ECMEC", lon: -80.7, lat: -0.96 },

  // ── Africa ──
  { name: "Durban", locode: "ZADUR", lon: 31.03, lat: -29.87 },
  { name: "Cape Town", locode: "ZACPT", lon: 18.44, lat: -33.91 },
  { name: "Port Elizabeth", locode: "ZAPLZ", lon: 25.64, lat: -33.96, aliases: ["NGQURA", "COEGA"] },
  { name: "Walvis Bay", locode: "NAWVB", lon: 14.51, lat: -22.96 },
  { name: "Lagos", locode: "NGLOS", lon: 3.39, lat: 6.45, aliases: ["APAPA", "TIN CAN", "ONNE", "LEKKI"] },
  { name: "Tema", locode: "GHTEM", lon: 1.0, lat: 5.63, aliases: ["TEMA GH", "TEMA GHANA"] },
  { name: "Abidjan", locode: "CIABJ", lon: -4.02, lat: 5.26 },
  { name: "Dakar", locode: "SNDKR", lon: -17.43, lat: 14.67 },
  { name: "Pointe Noire", locode: "CGPNR", lon: 9.66, lat: -4.79, aliases: ["POINTE NOIRE CG"] },
  { name: "Douala", locode: "CMDLA", lon: 9.7, lat: 4.05, aliases: ["KRIBI"] },
  { name: "Libreville", locode: "GALBV", lon: 9.45, lat: 0.39, aliases: ["OWENDO"] },
  { name: "Beira", locode: "MZBEW", lon: 34.84, lat: -19.83 },
  { name: "Maputo", locode: "MZMPM", lon: 32.58, lat: -25.97 },
  { name: "Dar es Salaam", locode: "TZDAR", lon: 39.66, lat: -6.82 },
  { name: "Mombasa", locode: "KEMBA", lon: 39.66, lat: -4.06, aliases: ["MOMBASA KENYA"] },
  { name: "Port Louis", locode: "MUPRL", lon: 57.5, lat: -20.15, aliases: ["PORT LOUIS MU"] },
  { name: "Reunion", locode: "RERUN", lon: 55.56, lat: -20.94, aliases: ["POINT DES GALETS", "LE PORT", "REUNION POINT DES GALETS"] },
  { name: "Toamasina", locode: "MGTOA", lon: 49.4, lat: -18.14, aliases: ["TAMATAVE"] },
  { name: "Victoria Seychelles", locode: "SCVSA", lon: 55.46, lat: -4.62, aliases: ["VICTORIA SC"] },
  { name: "Nouadhibou", locode: "MRNDB", lon: -17.03, lat: 20.93 },
];

/** Normalizes an AIS destination string for lookup: uppercase, punctuation
 *  stripped, vertical bar separators (common port-list forms) split off, and
 *  trailing ETA fragments ("ROTTERDAM ETA 1500") removed conservatively. */
export function normalizeDestination(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/ETA\b.*$/, "")
    .replace(/[-/;:,()@]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[-/;:,]+$/, "")
    .trim();
}

interface ResolvedPort {
  record: PortRecord;
  /** Display name for the map label (uppercase microtype style). */
  label: string;
}

const lookupCache = new Map<string, PortRecord | null>();

/** Index built lazily, longest keys first so longer anchored aliases win. */
let index: { key: string; record: PortRecord }[] | null = null;

function ensureIndex() {
  if (index) return;
  const entries: { key: string; record: PortRecord }[] = [];
  for (const record of PORTS) {
    const keys = new Set<string>([
      record.name.replace(/[.,]+/g, "").toUpperCase(),
      record.locode,
      ...(record.aliases ?? []),
    ]);
    for (const key of keys) {
      if (!key) continue;
      entries.push({ key: key.replace(/\s+/g, " ").toUpperCase(), record });
    }
  }
  entries.sort((a, b) => b.key.length - a.key.length);
  index = entries;
}

/**
 * Resolves an AIS `destination` free-text string to a port record.
 * Matching order: exact (name / LOCODE / alias), then exact-without-spaces
 * (handles "PORTSAID", "NLRTM"), then anchored prefix match (AIS fields are
 * truncated to 16 chars — "TANJUNG PELEPAS" -> "TANJUNG PELEP...", and
 * decorated forms like "ROTTERDAM NE"). Returns null for unknown strings.
 */
export function resolvePort(destination: string | null | undefined): ResolvedPort | null {
  if (!destination) return null;

  const normalized = normalizeDestination(destination);
  if (!normalized) return null;

  const cached = lookupCache.get(normalized);
  if (cached !== undefined) {
    return cached ? { record: cached, label: cached.name.toUpperCase() } : null;
  }

  ensureIndex();

  const noSpaces = normalized.replace(/\s+/g, "");
  const delim = / [-&/] /; // trailing notes: "SUEZ - SO", "NEW YORK / NJ"

  let resolved: PortRecord | null = null;
  for (const pass of [0, 1, 2]) {
    if (resolved) break;
    for (const { key, record } of index!) {
      const compactKey = key.replace(/\s+/g, "");
      const hit =
        pass === 0
          ? normalized === key || noSpaces === compactKey
          : pass === 1
            ? normalized.startsWith(key) && (key.length >= 6 || normalized.length - key.length <= 3)
            : compactKey.startsWith(noSpaces) && noSpaces.length >= 3;
      if (hit) {
        resolved = record;
        break;
      }
    }
  }

  // Split forms: leading segment of "SUEZ - SO" or "SUEZ/SO" and "ETA" splits.
  if (!resolved) {
    const lead = normalized.split(delim)[0].trim();
    if (lead !== normalized && lead.length >= 4) {
      for (const { key, record } of index!) {
        if (lead === key || lead.replace(/\s+/g, "") === key.replace(/\s+/g, "")) {
          resolved = record;
          break;
        }
      }
    }
  }

  lookupCache.set(normalized, resolved);
  return resolved ? { record: resolved, label: resolved.name.toUpperCase() } : null;
}
