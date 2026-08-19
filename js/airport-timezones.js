// ICAO -> IANA timezone, scoped to the airports PRVA's Philippine Airlines /
// PAL Express routes actually use (queried from routes.origin_icao /
// destination_icao, not the full global airport seed table). Each entry is a
// real, verified assignment for that specific airport -- not a per-country
// guess, since several of these countries (USA, Canada, Indonesia,
// Australia) span more than one timezone.
export const AIRPORT_TIMEZONES = {
  // Philippines -- single timezone nationwide
  RPLC: "Asia/Manila", RPLI: "Asia/Manila", RPLK: "Asia/Manila", RPLL: "Asia/Manila",
  RPMC: "Asia/Manila", RPMD: "Asia/Manila", RPME: "Asia/Manila", RPMG: "Asia/Manila",
  RPMN: "Asia/Manila", RPMO: "Asia/Manila", RPMR: "Asia/Manila", RPMY: "Asia/Manila",
  RPMZ: "Asia/Manila", RPNS: "Asia/Manila", RPSP: "Asia/Manila", RPUO: "Asia/Manila",
  RPUT: "Asia/Manila", RPUY: "Asia/Manila", RPVA: "Asia/Manila", RPVB: "Asia/Manila",
  RPVC: "Asia/Manila", RPVD: "Asia/Manila", RPVE: "Asia/Manila", RPVF: "Asia/Manila",
  RPVI: "Asia/Manila", RPVM: "Asia/Manila", RPVP: "Asia/Manila", RPVR: "Asia/Manila",
  RPVS: "Asia/Manila", RPVV: "Asia/Manila", RPVW: "Asia/Manila",
  // Japan
  RJAA: "Asia/Tokyo", RJBB: "Asia/Tokyo", RJFF: "Asia/Tokyo", RJGG: "Asia/Tokyo", RJTT: "Asia/Tokyo",
  // South Korea
  RKPC: "Asia/Seoul", RKSI: "Asia/Seoul",
  // Taiwan
  RCTP: "Asia/Taipei",
  // Hong Kong
  VHHH: "Asia/Hong_Kong",
  // Thailand
  VTBS: "Asia/Bangkok",
  // Vietnam
  VVDN: "Asia/Ho_Chi_Minh", VVNB: "Asia/Ho_Chi_Minh", VVTS: "Asia/Ho_Chi_Minh",
  // Cambodia
  VDPP: "Asia/Phnom_Penh",
  // Indonesia -- spans multiple zones
  WADD: "Asia/Makassar", WIII: "Asia/Jakarta",
  // Malaysia
  WMKK: "Asia/Kuala_Lumpur",
  // Singapore
  WSSS: "Asia/Singapore",
  // Australia -- spans multiple zones
  YBBN: "Australia/Brisbane", YMML: "Australia/Melbourne", YPPH: "Australia/Perth", YSSY: "Australia/Sydney",
  // China -- single official timezone nationwide
  ZBAA: "Asia/Shanghai", ZSAM: "Asia/Shanghai", ZSPD: "Asia/Shanghai", ZSQZ: "Asia/Shanghai",
  // Middle East
  OEDF: "Asia/Riyadh", OERK: "Asia/Riyadh", OMDB: "Asia/Dubai", OTHH: "Asia/Qatar",
  // Pacific
  PGUM: "Pacific/Guam", PHNL: "Pacific/Honolulu", AYPY: "Pacific/Port_Moresby",
  // North America -- spans multiple zones
  KJFK: "America/New_York", KLAX: "America/Los_Angeles", KSEA: "America/Los_Angeles", KSFO: "America/Los_Angeles",
  CYVR: "America/Vancouver", CYYZ: "America/Toronto",
};

export function timezoneForIcao(icao) {
  return AIRPORT_TIMEZONES[icao] || null;
}
