/* normalize.js — turn each vendor's holdings vocabulary into one shared one.
 *
 * The Fact Sheet's whole purpose is spotting the same company held through
 * several funds. That only works if every fund's rows resolve to the same key,
 * and no two fund providers agree on identifiers or sector names:
 *
 *   iShares (XEQT)   bare tickers        "NVDA"        sector "Information Technology"
 *   Vanguard (VDY)   bare tickers        "RY"          sector "Basic Materials"
 *   Roundhill (CHAT) Bloomberg-style     "2330 TT"     no sector column at all
 *   Fidelity (FINN)  security names only "Nvidia"      no tickers at all
 *
 * Everything here is a deliberate editorial mapping. Anything not confidently
 * resolvable is left unmatched rather than guessed — a wrong match invents
 * overlap that does not exist, which is worse than reporting none.
 */
'use strict';

/* --------------------------------------------------------------- sectors */
/* Canonical set = GICS names, which is what the dashboard groups by. */
const SECTORS = {
  'information technology': 'Technology',
  'technology': 'Technology',
  'communication': 'Communication Services',
  'communication services': 'Communication Services',
  'telecommunications': 'Communication Services',
  'basic materials': 'Materials',
  'materials': 'Materials',
  'financials': 'Financials',
  'financial services': 'Financials',
  'energy': 'Energy',
  'consumer discretionary': 'Consumer Discretionary',
  'consumer staples': 'Consumer Staples',
  'health care': 'Health Care',
  'healthcare': 'Health Care',
  'industrials': 'Industrials',
  'utilities': 'Utilities',
  'real estate': 'Real Estate',
  'other': 'Other',
  'cash and/or derivatives': 'Cash'
};

function sector(raw) {
  if (!raw) return null;
  return SECTORS[String(raw).trim().toLowerCase()] || String(raw).trim();
}

/* ------------------------------------------------------------ geography */
const COUNTRIES = {
  CA: 'Canada', US: 'United States', KR: 'South Korea', TW: 'Taiwan',
  JP: 'Japan', HK: 'Hong Kong', CN: 'China', GB: 'United Kingdom',
  FR: 'France', DE: 'Germany', CH: 'Switzerland', NL: 'Netherlands',
  IT: 'Italy', SE: 'Sweden', DK: 'Denmark', ES: 'Spain', AU: 'Australia',
  IN: 'India', IL: 'Israel', PL: 'Poland', AT: 'Austria', SG: 'Singapore',
  BR: 'Brazil', IE: 'Ireland', FI: 'Finland', NO: 'Norway', BE: 'Belgium'
};

/* Bloomberg-style exchange codes, as used by Roundhill's CHAT file. */
const EXCHANGE_COUNTRY = {
  KS: 'South Korea', KQ: 'South Korea', TT: 'Taiwan', JP: 'Japan',
  HK: 'Hong Kong', C1: 'China', C2: 'China', CH: 'China', FP: 'France',
  GY: 'Germany', GR: 'Germany', LN: 'United Kingdom', SW: 'Switzerland',
  NA: 'Netherlands', IM: 'Italy', SS: 'Sweden', SM: 'Spain',
  AU: 'Australia', IN: 'India', IT: 'Israel', US: 'United States'
};

function geography(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (COUNTRIES[s.toUpperCase()]) return COUNTRIES[s.toUpperCase()];
  return s;
}

/* --------------------------------------------------------------- tickers */

/* Bloomberg-style "2330 TT" -> { base: "2330", country: "Taiwan" }. */
function splitExchange(raw) {
  const m = String(raw).trim().match(/^(\S+)\s+([A-Z0-9]{2})$/);
  if (!m) return { base: String(raw).trim(), country: null };
  return { base: m[1], country: EXCHANGE_COUNTRY[m[2]] || null };
}

/* Local listings and depositary receipts of the same company, folded onto one
   key so cross-fund exposure aggregates instead of splitting in two.
   Left-hand side is what a vendor file might contain. */
const TICKER_ALIASES = {
  // Taiwan Semiconductor: US ADR, local Taipei line, and CHAT's Bloomberg form
  '2330': 'TSM',
  // Samsung Electronics
  '005930': '005930.KS',
  // SK hynix: local line and the unsponsored US ADR
  '000660': '000660.KS', 'SKHY': '000660.KS',
  // Samsung Electronics preferred (005935) is the same company as the ordinary
  // line; DRAM lists both, and they are one exposure.
  '005935': '005930.KS',
  // Canadian tickers arrive bare from iShares/Vanguard; the portfolio holds the
  // .TO listings, so normalize onto those for direct-holding overlap.
  'RY': 'RY.TO', 'TD': 'TD.TO', 'BMO': 'BMO.TO', 'BNS': 'BNS.TO', 'CM': 'CM.TO',
  'NA': 'NA.TO', 'ENB': 'ENB.TO', 'TRP': 'TRP.TO', 'CNQ': 'CNQ.TO', 'SU': 'SU.TO',
  'MFC': 'MFC.TO', 'SLF': 'SLF.TO', 'CVE': 'CVE.TO', 'POW': 'POW.TO', 'NTR': 'NTR.TO',
  'FTS': 'FTS.TO', 'PPL': 'PPL.TO', 'QSR': 'QSR.TO', 'BCE': 'BCE.TO', 'MG': 'MG.TO',
  'BAM': 'BAM.TO', 'T': 'T.TO', 'EMA': 'EMA.TO', 'GWO': 'GWO.TO', 'TOU': 'TOU.TO',
  'WCP': 'WCP.TO', 'ARX': 'ARX.TO', 'ALA': 'ALA.TO', 'KEY': 'KEY.TO', 'CPX': 'CPX.TO',
  'SOBO': 'SOBO.TO', 'OTEX': 'OTEX.TO', 'PSK': 'PSK.TO', 'BEPC': 'BEPC.TO',
  'AQN': 'AQN.TO', 'IGM': 'IGM.TO', 'NPI': 'NPI.TO', 'GEI': 'GEI.TO', 'PEY': 'PEY.TO',
  'PBH': 'PBH.TO', 'TPZ': 'TPZ.TO', 'RUS': 'RUS.TO', 'HWX': 'HWX.TO', 'FRU': 'FRU.TO',
  'SCR': 'SCR.TO', 'NWC': 'NWC.TO', 'SIA': 'SIA.TO', 'MFI': 'MFI.TO', 'PXT': 'PXT.TO',
  'VET': 'VET.TO', 'CCA': 'CCA.TO', 'LIF': 'LIF.TO', 'SPB': 'SPB.TO', 'WTE': 'WTE.TO',
  'ENGH': 'ENGH.TO', 'GSY': 'GSY.TO', 'LNF': 'LNF.TO', 'SHOP': 'SHOP.TO',
  'CP': 'CP.TO', 'CNR': 'CNR.TO', 'AEM': 'AEM.TO', 'ATD': 'ATD.TO', 'TRI': 'TRI.TO',
  'WCN': 'WCN.TO', 'CAE': 'CAE.TO', 'DOL': 'DOL.TO', 'TECK.B': 'TECK.B.TO',
  'QBR/B': 'QBR.B.TO', 'CTC/A': 'CTC.A.TO', 'TCL/A': 'TCL.A.TO',
  'IMO': 'IMO.TO', 'K': 'K.TO', 'ABX': 'ABX.TO', 'WPM': 'WPM.TO', 'FNV': 'FNV.TO',
  'FM': 'FM.TO', 'LUN': 'LUN.TO', 'ERO': 'ERO.TO', 'IMG': 'IMG.TO', 'MDI': 'MDI.TO'
};

/* Fidelity's listing carries security names and nothing else, so names have to
   be resolved by hand. Only unambiguous, material holdings are mapped; the rest
   stay name-keyed and simply do not participate in overlap detection. */
const NAME_TO_TICKER = {
  'nvidia': 'NVDA',
  'amazon.com': 'AMZN',
  'alphabet, cl. a': 'GOOGL',
  'alphabet, cl. c': 'GOOG',
  'microsoft': 'MSFT',
  'meta platforms': 'META',
  'taiwan semiconductor manufacturing': 'TSM',
  'sk hynix': '000660.KS',
  'samsung electronics': '005930.KS',
  'micron technology': 'MU',
  // As published on DRAM's swap rows, once the swap decoration is stripped.
  'micron technology inc': 'MU',
  'micron technology, inc.': 'MU',
  'sk hynix inc': '000660.KS',
  'western digital': 'WDC',
  'applovin corporation': 'APP',
  'roblox corporation': 'RBLX',
  'intel': 'INTC',
  'seagate technology holdings': 'STX',
  'arista networks': 'ANET',
  'sandisk': 'SNDK',
  'roche holding': 'ROG.SW',
  'galaxy digital': 'GLXY.TO',
  'intuitive surgical': 'ISRG',
  'coherent corp': 'COHR',
  'lumentum holdings inc': 'LITE',
  'braze inc': 'BRZE',
  'insmed inc': 'INSM',
  'coca-cola consolidated': 'COKE',
  'first quantum minerals': 'FM.TO',
  'eli lilly and company': 'LLY',
  'roku': 'ROKU',
  'marvell technology': 'MRVL',
  'costco wholesale': 'COST',
  'british american tobacco': 'BTI',
  'caterpillar': 'CAT',
  'gilead sciences': 'GILD',
  'sharkninja': 'SN',
  'kla corporation': 'KLAC',
  'mckesson corp.': 'MCK',
  'komatsu': '6301.T',
  'nokia corp spon adr': 'NOK',
  'disco corporation': '6146.T',
  'ibiden': '4062.T',
  'lasertec': '6920.T',
  'monolithic power sys inc': 'MPWR',
  'digitalocean holdings inc': 'DOCN',
  'natera inc': 'NTRA',
  '10x genomics': 'TXG',
  'bp': 'BP',
  'microchip technology': 'MCHP',
  'pultegroup inc': 'PHM',
  'kb home': 'KBH',
  'ralph lauren corp.': 'RL',
  'lennar corp cl a': 'LEN',
  'pfizer inc cvr rt': 'PFE',
  // Canadian equities section
  'canadian natural resources': 'CNQ.TO',
  'agnico eagle mines': 'AEM.TO',
  'shopify': 'SHOP.TO',
  'suncor energy': 'SU.TO',
  'canadian pacific kansas city limited': 'CP.TO',
  'teck resources, cl. b, sub vtg': 'TECK.B.TO',
  'dollarama': 'DOL.TO',
  'ero copper': 'ERO.TO',
  'iamgold corporation': 'IMG.TO',
  'lundin mining': 'LUN.TO',
  'kinross gold': 'K.TO',
  'tourmaline oil': 'TOU.TO',
  'major drilling group international': 'MDI.TO',
  'alamos gold inc a': 'AGI.TO'
};

/* Companies whose sector is needed but whose source file omits it (CHAT has no
   sector column; Fidelity's listing has none either). Only names that are
   unambiguous are listed. */
const SECTOR_BY_TICKER = {
  NVDA: 'Technology', AAPL: 'Technology', MSFT: 'Technology', AVGO: 'Technology',
  TSM: 'Technology', MU: 'Technology', WDC: 'Technology', INTC: 'Technology',
  STX: 'Technology', ANET: 'Technology', SNDK: 'Technology', KLAC: 'Technology',
  MRVL: 'Technology', MPWR: 'Technology', MCHP: 'Technology', COHR: 'Technology',
  LITE: 'Technology', APP: 'Technology', DOCN: 'Technology', BRZE: 'Technology',
  VRT: 'Industrials', CAT: 'Industrials', KOMATSU: 'Industrials',
  AMZN: 'Consumer Discretionary', RBLX: 'Communication Services',
  GOOGL: 'Communication Services', GOOG: 'Communication Services',
  META: 'Communication Services', NOK: 'Technology', ROKU: 'Communication Services',
  LLY: 'Health Care', GILD: 'Health Care', ISRG: 'Health Care', MCK: 'Health Care',
  INSM: 'Health Care', NTRA: 'Health Care', TXG: 'Health Care',
  COST: 'Consumer Staples', COKE: 'Consumer Staples', BTI: 'Consumer Staples',
  BP: 'Energy', SN: 'Consumer Discretionary', RL: 'Consumer Discretionary',
  PHM: 'Consumer Discretionary', KBH: 'Consumer Discretionary',
  LEN: 'Consumer Discretionary', PFE: 'Health Care',
  '000660.KS': 'Technology', '005930.KS': 'Technology',
  // DRAM's memory and storage constituents; Roundhill publishes no sector.
  '2337': 'Technology', '2344': 'Technology', '2408': 'Technology',
  '285A': 'Technology', '603986': 'Technology', '8299': 'Technology',
  '~CXMT-CORPORATION': 'Technology'
};

/* Countries for holdings whose own row cannot supply one. A swap row names a
   contract, not an exchange, so an underlying with no listing of its own has
   nowhere else to get its country from. */
const GEOGRAPHY_BY_TICKER = {
  // ChangXin Memory Technologies — Hefei, China; DRAM holds it only via swap.
  '~CXMT-CORPORATION': 'China'
};

/* Resolve a vendor row to a canonical ticker.
   Returns { ticker, matched } — matched:false means the row keeps a name-derived
   key and will not be treated as the same holding as any other fund's row. */
function canonicalTicker(rawTicker, name) {
  if (rawTicker) {
    const { base, country } = splitExchange(rawTicker);
    const up = base.toUpperCase().replace(/\s+/g, '');
    const alias = TICKER_ALIASES[up];
    /* The bare-ticker aliases above are all Canadian, and several collide with
       a foreign symbol: Schneider Electric is "SU FP" in Roundhill's file and
       must not fold onto Suncor's SU.TO. Where the row's own exchange code says
       the listing is not Canadian, the alias does not apply. */
    if (alias && !(country && country !== 'Canada' && /\.TO$/.test(alias))) {
      return { ticker: alias, matched: true };
    }
    if (up && up !== 'CASH&OTHER' && up !== '-') return { ticker: up, matched: true };
  }
  if (name) {
    const key = String(name).trim().toLowerCase().replace(/\s+/g, ' ');
    if (NAME_TO_TICKER[key]) return { ticker: NAME_TO_TICKER[key], matched: true };
    /* Unresolvable: key on the name so it still contributes to sector and
       geography totals, but can never collide with another fund's holding. */
    return {
      ticker: '~' + String(name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 40),
      matched: false
    };
  }
  return { ticker: null, matched: false };
}

function sectorFor(ticker, raw) {
  const s = sector(raw);
  if (s) return s;
  return SECTOR_BY_TICKER[ticker] || null;
}

function geographyFor(ticker, raw) {
  return geography(raw) || GEOGRAPHY_BY_TICKER[ticker] || null;
}

/* Rows that are cash, FX or derivatives rather than a company. These are
   excluded from the constituent list; the weight they represent shows up in the
   Unresolved bucket, which is the honest place for it. */
function isNonEquity(name, assetClass) {
  const n = String(name || '').toLowerCase();
  const a = String(assetClass || '').toLowerCase();
  if (/cash|futures|money market|margin|^fx$/.test(a)) return true;
  if (/\bcash\b|spot cc|currency|money market|^euro$|dollar$|zloty|\bnet other assets\b/.test(n)) return true;
  /* Collateral, not a constituent. A swap-based fund parks most of its cash in
     bills and a government money market fund against the swap notional — DRAM
     holds 38% that way. Counted as holdings they crowd out every real name. */
  return /\btreasury bill\b|\bt-bill\b|government obligations fund/.test(n);
}

module.exports = {
  sector, sectorFor, geography, geographyFor, splitExchange, canonicalTicker,
  isNonEquity, COUNTRIES, EXCHANGE_COUNTRY, TICKER_ALIASES, NAME_TO_TICKER,
  SECTOR_BY_TICKER, GEOGRAPHY_BY_TICKER
};
