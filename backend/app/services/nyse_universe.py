"""
NYSE expansion universe — 1,500 additional NYSE-listed common stocks.

Selection (2026-07-09): every symbol in the official NYSE listing directory
(NASDAQ Trader symbol directory / NASDAQ stock-screener feed, exchange=NYSE),
filtered to common stocks only — preferred shares, warrants, rights, SPAC
units, notes/debentures, closed-end funds and ETFs are excluded; NYSE-listed
ADS commons and MLP common units are kept — then the 1,500 largest by market
cap that are not already in the core 599-stock universe in market_data.py.
(The last four entries — BF-B, BF-A, HEI-A, CRD-A — are secondary share
classes of established NYSE companies whose market-cap field is blank in the
directory; they top the ranked pool up to exactly 1,500.)

Ordered largest market cap first. Symbols use Yahoo Finance notation
(class shares use a dash: BRK-A, not BRK.A) because every fetch path goes
through yfinance. NYSE-only by construction — do not add NASDAQ/AMEX symbols
here; those belong in the core universe list.

This list is a snapshot and goes stale as small caps delist or rename. Do
not edit it by hand — regenerate it (quarterly is plenty) with:
    python3 scripts/refresh_nyse_universe.py
and review the resulting diff like any code change.
"""

def assert_unique_universe(name: str, tickers, expected: int | None = None) -> None:
    """Runtime invariant shared by every universe list (asserts are stripped
    under `python -O`, and a wrong list would silently skew breadth,
    gainers/losers, and the screener — so this must survive prod).

    Names the offending tickers on failure instead of only aggregate counts,
    so a bad edit is a one-line fix rather than a hand-diff of 2,000+ lines.
    Pass `expected` to also pin the count of a hand-maintained list; omit it
    for derived/combined lists so their size never needs a third literal
    kept in lockstep.
    """
    from collections import Counter

    dupes = sorted(t for t, n in Counter(tickers).items() if n > 1)
    if dupes:
        raise RuntimeError(f"{name} contains duplicate tickers: {', '.join(dupes[:10])}")
    if expected is not None and len(tickers) != expected:
        raise RuntimeError(
            f"{name} must contain exactly {expected} tickers; got {len(tickers)}"
        )


NYSE_EXPANSION: tuple[str, ...] = (
    "BRK-A", "AZN", "HSBC", "NVS", "GEV", "RY", "MUFG", "SHEL", "SAN", "BHP",
    "TD", "TTE", "SMFG", "UBS", "BBVA", "BUD", "SCCO", "CB", "PGR", "UL",
    "BTI", "MFG", "BMO", "VRT", "ENB", "RIO", "PBR", "HWM", "GSK", "BN",
    "CM", "BNS", "BNY", "BP", "MCK", "BCS", "ING", "ACN", "ASX", "CNQ",
    "BX", "RACE", "LYG", "MRSH", "EQNR", "JCI", "KKR", "NGG", "EPD", "CP",
    "AON", "E", "CNI", "BAM", "CVNA", "AEM", "TDG", "BE", "NWG", "TRP",
    "MSI", "SU", "CRH", "NOK", "MFC", "ET", "APO", "RSG", "URI", "DB",
    "AJG", "UMC", "AFL", "STM", "COR", "VALE", "B", "FIX", "HPE", "RELX",
    "MPLX", "DAL", "CTVA", "SOMN", "CAH", "LNG", "LHX", "ETR", "CVE", "WPM",
    "HEI", "MT", "ABEV", "PCG", "DEO", "VTR", "IX", "AMP", "SLF", "WCN",
    "VIK", "FMX", "HLN", "FERG", "VIV", "HMC", "KB", "CLS", "CCJ", "AU",
    "RKT", "FNV", "ARES", "TEVA", "ADM", "WDS", "BSBR", "RDDT", "PPLC", "BBD",
    "BAP", "PUK", "SHG", "CPNG", "CHT", "ALC", "NTR", "UI", "BBDO", "CQP",
    "AEE", "EC", "VG", "EXR", "MTZ", "Q", "TDY", "TS", "GFI", "FTS",
    "CRS", "AXIA", "SUNB", "XYL", "CW", "PBA", "KGC", "TECK", "NMR", "AMRZ",
    "TPL", "PHG", "PPL", "AER", "AVB", "P", "WSM", "MTD", "NVT", "IHG",
    "MKL", "LUV", "BRO", "DGX", "DRI", "BEP", "CPAY", "VLTO", "SW", "ROL",
    "EXPD", "SQM", "SN", "RBA", "TSN", "STE", "SBS", "BCH", "BCE", "GPN",
    "EFX", "SNX", "EDU", "FLUT", "AMCR", "DKS", "AS", "YPF", "RBC", "LII",
    "FTV", "CX", "LYB", "APG", "PAAS", "ZTO", "WES", "THC", "RCI", "H",
    "BEN", "ULS", "RBRK", "NVR", "MGA", "BEKE", "MAIR", "BIP", "FN", "GPC",
    "FDXF", "BR", "BWXT", "KIM", "AEG", "PKX", "ITT", "NLY", "EMA", "TU",
    "WY", "OVV", "CRCL", "CLH", "CDE", "KEP", "LTM", "STLA", "TXT", "BSAC",
    "SGI", "J", "QXO", "WF", "JLL", "DOC", "YUMC", "RGA", "DTM", "ARMK",
    "DVA", "PNFP", "TRU", "OHI", "EG", "GFL", "BNT", "OWL", "SUN", "JHX",
    "GIB", "UNM", "TLK", "CNA", "TME", "RRX", "FPS", "AIZ", "RNR", "CRBG",
    "TOL", "BEPC", "LDOS", "KLAR", "CSL", "FMS", "TYL", "BWA", "SOLV", "U",
    "DY", "EVR", "CNH", "SNN", "UHAL", "XPEV", "JBS", "MOD", "SKM", "APTV",
    "CR", "ELAN", "MLI", "NIO", "AGI", "WBS", "CCK", "RVTY", "KNX", "TFII",
    "AVY", "AMH", "PAG", "IVZ", "PAC", "NYT", "PNR", "RDY", "AFG", "WTS",
    "EMBJ", "FIG", "HII", "BROS", "MICC", "SF", "MUSA", "WMS", "BJ", "WTRG",
    "EHC", "CACI", "RYAN", "AM", "PSO", "SPXC", "BXP", "SCI", "AHR", "VMI",
    "JEF", "TIMB", "R", "DCI", "ARW", "HL", "ORI", "SUZ", "GTLS", "VIRT",
    "PL", "CTRE", "GME", "WLK", "DAR", "CFR", "ESI", "TKR", "SSB", "BRX",
    "UHS", "MP", "GIL", "PRI", "AMG", "LEVI", "SARO", "ADC", "AGX", "OSCR",
    "HLI", "ALSN", "LTH", "HMY", "IT", "GKOS", "YMM", "FLS", "CNM", "KT",
    "FDS", "ALV", "OSK", "ACM", "IAG", "ESE", "WAL", "PRMB", "FR", "FRO",
    "ELPC", "ASR", "GGB", "BMNR", "COMP", "PB", "TX", "AXS", "CAE", "IDA",
    "OKLO", "AOS", "HBM", "DDS", "KNSL", "KNTK", "STN", "ATR", "SGHC", "RHP",
    "QGEN", "ZWS", "AG", "JAN", "SSD", "SOBO", "UGI", "RAL", "RSI", "BIO",
    "RTO", "KEX", "QBTS", "JXN", "NFG", "BAH", "EAT", "HXL", "THG", "YOU",
    "LNC", "STAG", "TEX", "ENS", "TAP", "FSS", "JBTM", "BVN", "TRNO", "NEU",
    "VNO", "HR", "ACA", "FAF", "MAC", "PACS", "AROC", "FLR", "ACI", "LAD",
    "MBGL", "CMC", "ECG", "HNGE", "ORA", "LUMN", "VIST", "LOAR", "NPO", "EPRT",
    "TMHC", "DPC", "SSL", "AVTR", "MSM", "KRMN", "OMF", "IFS", "GAP", "VIPS",
    "SWX", "MHK", "FNB", "LEA", "ICL", "GBCI", "GTES", "GOLF", "BB", "VSH",
    "MSA", "BYD", "ST", "INGM", "CHE", "RYN", "UGP", "EXP", "NE", "SNDR",
    "AN", "GVA", "PBF", "ESTC", "PJT", "TXNM", "KGS", "MATX", "GATX", "BBUC",
    "MCY", "STWD", "VSXY", "ENIC", "NXE", "CPA", "FLG", "PSN", "POR", "ABCB",
    "LB", "M", "CIG", "MTG", "BLCO", "PATH", "TV", "ESNT", "SBSW", "STVN",
    "OUT", "FND", "AUB", "FBIN", "NJR", "BMA", "IBP", "WH", "GXO", "TFPM",
    "HOMB", "TAL", "ASB", "ENVA", "TEO", "RLI", "BKH", "PRM", "KOF", "OR",
    "LMND", "OGC", "AX", "SPHR", "SON", "ZETA", "WTM", "MDA", "OBDC", "AIR",
    "ALK", "ESAB", "BIPC", "MTRN", "MTN", "WFG", "AMTM", "SXT", "MC", "ALH",
    "LPX", "PIPR", "RITM", "HESM", "GHC", "TKC", "RDN", "MTH", "G", "KVYO",
    "HRB", "MUR", "MANE", "CUZ", "ADT", "UNF", "OGS", "GBTG", "CMBT", "BC",
    "CNO", "SEI", "PRIM", "CHH", "TBBB", "REZI", "VVV", "HASI", "STUB", "BOOT",
    "MAIN", "NNI", "SR", "DLB", "FCN", "OTF", "MRP", "HRI", "CRC", "KTB",
    "SLGN", "KBR", "SFBS", "EPR", "LAZ", "TNL", "KNF", "EE", "SKT", "PAM",
    "EPAM", "KRC", "CVSA", "ANDG", "TGS", "RXO", "CSW", "ELF", "AQN", "INSW",
    "NP", "MDU", "SKY", "FHI", "TAC", "AZZ", "HHH", "BCO", "GPGI", "BMI",
    "BRC", "WBI", "PFSI", "OPLN", "BNL", "NVST", "HGTY", "UCB", "CDP", "BDC",
    "GFF", "MIR", "HCC", "OII", "PLNT", "CRK", "CAAP", "CNR", "ATMU", "CWEN",
    "CSTM", "CON", "FBP", "VNT", "STNG", "BBAR", "IRT", "MIAX", "TPC", "DOCS",
    "GEO", "TDS", "BFAM", "LION", "CNS", "BETA", "USAC", "HGV", "BBWI", "PHI",
    "MWA", "ANF", "BLSH", "RNST", "LRN", "ABG", "RCUS", "APLE", "BFH", "FG",
    "MANU", "THO", "MHO", "PII", "NHI", "WPP", "ACHR", "AGO", "MNSO", "SXI",
    "HAFN", "KFY", "YETI", "SUNC", "ZGN", "BKD", "AADX", "OGN", "MSGE", "KBH",
    "PAY", "GNW", "KEN", "GPI", "CURB", "KAI", "BKU", "NSA", "HIW", "SLG",
    "HAYW", "PARR", "HG", "DK", "CBU", "NIC", "JOE", "XXI", "AB", "WRBY",
    "RHI", "HAE", "AAP", "TDC", "GEF", "NATL", "CALY", "AWR", "LEU", "UWMC",
    "LXP", "QTWO", "VAC", "SKE", "NIQ", "BWLP", "BOH", "SIG", "SMR", "CRGY",
    "CWK", "TTAM", "CGAU", "GRBK", "ITGR", "BANC", "CVI", "VTMX", "BTE", "CXW",
    "BSM", "CPK", "MMS", "AD", "GPK", "KN", "PFS", "EFXT", "HTGC", "FUL",
    "ZIM", "FSK", "CWT", "BHE", "GPOR", "BKV", "ASH", "WK", "CSAN", "APAM",
    "DKL", "ARIS", "DBD", "UE", "SPNT", "TR", "FBK", "BXMT", "DBRG", "EROC",
    "VGNT", "SII", "WT", "UNFI", "DHT", "AAUC", "ARX", "PHIN", "GRND", "AKR",
    "EROK", "CXT", "DX", "BTU", "HNI", "SAH", "PK", "DAN", "IVT", "UAA",
    "AAMI", "FCPT", "IHS", "YSS", "UTI", "TRN", "AMBP", "UA", "SA", "MPT",
    "ATS", "ATEN", "HOG", "BGSI", "WLYB", "CTRI", "WTTR", "KD", "HLIO", "DCO",
    "ABM", "WOR", "KWR", "CUBI", "GRDN", "WLY", "SDRL", "PAGS", "TNET", "RDW",
    "KMT", "INFQ", "BCC", "BHVN", "NGVT", "ERO", "TNK", "BBT", "FSM", "LCII",
    "WHR", "AERO", "ROG", "WU", "VVX", "TAK", "NTB", "TALO", "CMCM", "DNOW",
    "PBI", "HE", "ATKR", "SHAK", "DAC", "ATHM", "HCI", "PBH", "EXK", "MTX",
    "CEPU", "CTOS", "NMM", "LCLN", "HTH", "MD", "PRKS", "HMN", "MNR", "PLGO",
    "ECO", "AGM", "BKE", "NTST", "BLX", "ARR", "NWN", "GTY", "OFG", "GRC",
    "CPRI", "SHO", "TE", "STC", "NOG", "NUVB", "FCF", "AIN", "VOYG", "PEB",
    "BRSL", "LTC", "ALG", "CBZ", "AVEX", "NBHC", "WMK", "CDLR", "NGL", "DEI",
    "TGLS", "AMR", "BFLY", "LPL", "BOBS", "FUN", "TY", "SNDA", "MH", "GNL",
    "NVRI", "SIND", "COTY", "EPAC", "SPB", "VSTS", "LOB", "AGL", "WOLF", "SAM",
    "HAWK", "BHC", "GEL", "FLOC", "CCS", "XHR", "IIPR", "SMA", "KSS", "BXDC",
    "CMRE", "AESI", "TFIN", "DRD", "CYD", "SSMR", "MAN", "INVX", "TIC", "AMBQ",
    "LPG", "PRLB", "WKC", "PRG", "ARCO", "DV", "EVTC", "KMPR", "FIGS", "TRLV",
    "TPB", "AMC", "NEXA", "DCOM", "DAO", "WD", "CTS", "EFC", "GLP", "RLJ",
    "FLNG", "NSP", "XPRO", "BY", "AMPX", "GENI", "TDOC", "WS", "KRP", "NOMD",
    "CBL", "BW", "TSLX", "SFL", "XZO", "RVLV", "DXC", "BBAI", "PUMP", "REX",
    "OBK", "GAM", "AAT", "LZB", "FOR", "LEG", "SLVM", "IDT", "ODC", "AGRO",
    "PRSU", "SVV", "OI", "TNC", "VET", "VIA", "PRGO", "ARDT", "ADNT", "VPG",
    "GBX", "DFH", "GSL", "INSP", "CLVT", "YELP", "CRI", "BORR", "ARLO", "ALX",
    "AI", "ENR", "WWW", "SBH", "SECZ", "ENOV", "KOS", "NVGS", "RYZ", "LSPD",
    "DMC", "ARI", "ORC", "HLX", "DOLE", "AMRC", "BV", "NRP", "ECVT", "HLF",
    "UVV", "VTOL", "LOMA", "UMH", "GLOB", "NBR", "NAT", "CXM", "TWO", "PBT",
    "TTI", "SCL", "GIC", "LAC", "RES", "GHM", "UAN", "AMN", "TDAY", "IRS",
    "LADR", "CDRE", "PXED", "CCO", "SID", "CMP", "ACVA", "DCH", "LAR", "LU",
    "NPKI", "OPY", "SPH", "EPC", "GOLD", "MCB", "TEN", "XIFR", "MMI", "PDM",
    "AVNS", "UVE", "ASIC", "RHLD", "DEA", "MYE", "TUYA", "CVLG", "AORT", "SAFE",
    "UTZ", "AGBK", "LNN", "EDN", "ABX", "FINV", "MBC", "DFIN", "VYX", "GNK",
    "DLX", "NMAX", "JBGS", "CIM", "SBR", "EVC", "DEC", "USPH", "PDS", "MUX",
    "BOW", "FUBO", "LUXE", "HQH", "VRTS", "ACEL", "CNMD", "SBSI", "GSBD", "CPAC",
    "ENHA", "PLOW", "EEX", "UAMY", "EQBK", "VLRS", "CPF", "BAK", "BCX", "WSR",
    "COUR", "LUCK", "FSCO", "AMTB", "BKSY", "TROX", "TK", "ABR", "UTL", "KFRC",
    "MFA", "BUR", "EIG", "ESRT", "SG", "CSR", "BH", "ASA", "TBN", "GOOS",
    "ANRO", "KOP", "PMT", "KBDC", "GLAS", "RERE", "NPK", "BFS", "EVEX", "BBDC",
    "SUPV", "CAPL", "NXDR", "MNTN", "MTAL", "BZH", "MAX", "JMIA", "GMRS", "FTK",
    "INR", "HPP", "SMP", "HRTG", "BCSF", "YALA", "NABL", "MOV", "WGO", "RPC",
    "LXU", "CCU", "HTB", "DQ", "JKS", "KODK", "SMBK", "WLKP", "MTUS", "SDHC",
    "OPFI", "HZO", "PD", "ONT", "NGVC", "SKYH", "OFRM", "RSKD", "FPH", "CODI",
    "PKE", "SOC", "HIPO", "VTEX", "GDOT", "NX", "EFOR", "IBTA", "ODV", "TXO",
    "CTO", "ANGX", "IVR", "GFR", "HOV", "HSHP", "PFLT", "PAR", "NXRT", "JBI",
    "SB", "BRSP", "WHK", "SXC", "VEL", "NOAH", "INN", "MCS", "KRO", "BWMX",
    "NXP", "PSTL", "MEC", "VTS", "PHR", "CWH", "SPIR", "ASC", "TRTX", "TCBX",
    "OPTU", "NRGV", "SMC", "EVH", "NPB", "CNNE", "NCDL", "RGR", "GRNT", "CSV",
    "UHT", "FBRT", "BALY", "RWT", "KLC", "CLDT", "BTGO", "ORN", "EGY", "HY",
    "DNA", "IIIN", "FET", "ASIX", "MEI", "MLR", "CTEV", "HUYA", "ALIT", "OLP",
    "ETD", "OOMA", "SMWB", "WEAV", "AHRT", "WTI", "EBF", "BDN", "OXM", "PACK",
    "HQL", "TYG", "GPRK", "CLB", "MG", "NGS", "CHCT", "SD", "OIS", "ETO",
    "CYH", "WNC", "PSFE", "TRC", "YEXT", "RYAM", "XRN", "DDL", "CPS", "EVMN",
    "FVR", "IPI", "KREF", "TWI", "CMDB", "FCBM", "MTW", "MAGN", "DDD", "GOTU",
    "BBBY", "DIN", "BLND", "ASPN", "BOC", "SGU", "CINT", "QUAD", "ZKH", "SI",
    "EBS", "CBAN", "FPI", "DDT", "AIV", "HTT", "MATV", "AVBC", "BNED", "TCI",
    "HVT", "BXC", "USNA", "FVRR", "VHI", "CAL", "SOR", "AUNA", "MSC", "XPER",
    "NOA", "RNGR", "BBW", "AII", "BKKT", "RM", "LDI", "GNE", "KNOP", "LND",
    "GCO", "NPWR", "ACCO", "NC", "FTW", "CVEO", "MCI", "ARL", "GETY", "PPT",
    "MLP", "PINE", "XPOF", "SEG", "MBI", "MSB", "SSTK", "YSG", "BGS", "ZIP",
    "CION", "ONIT", "COSO", "OEC", "CMTG", "HLLY", "LZM", "SES", "BRCC", "NL",
    "NREF", "SAR", "KWY", "UP", "SPCE", "CIA", "ZH", "DBI", "BRT", "HBB",
    "OSG", "NXDT", "RC", "CBNA", "DSX", "XYF", "UIS", "TG", "NMG", "LAW",
    "TBI", "NUS", "CLW", "ACH", "MITT", "ACRE", "RMAX", "SCM", "JILL", "CABO",
    "FOA", "GCTS", "AOMR", "PNNT", "EVTL", "FC", "SITC", "VLN", "SMHI", "FF",
    "ALTG", "FT", "SMRT", "SRI", "CURV", "COOK", "TPVG", "HKD", "WHG", "MDV",
    "PERF", "NRDY", "DOUG", "MPV", "DHX", "LANV", "AMPY", "EARN", "LVWR", "TRAK",
    "NLOP", "ADCT", "KORE", "PIM", "OWLT", "ONL", "VATE", "DAVA", "GNT", "EAF",
    "SRG", "CHPT", "AP", "AMWL", "FIRY", "SJT", "BHR", "ELME", "SLQT", "AXR",
    "MX", "TLYS", "DLNG", "ZVIA", "BEBE", "RFL", "GHI", "ACR", "AKA", "TSQ",
    "GHG", "MED", "RPT", "YRD", "JELD", "CHGG", "UFI", "SRFM", "AMTD", "AVD",
    "WBX", "BARK", "PEW", "CHMI", "SRL", "ZEPP", "TISI", "IH", "SKIL", "ANVS",
    "GPMT", "NRT", "BGSF", "CATO", "STEM", "PVL", "CRT", "LITB", "VOC", "STG",
    "GROV", "CNF", "SQNS", "LFT", "TGE", "CLPR", "SPRU", "LOCL", "PRT", "SST",
    "GWH", "OPAD", "NYC", "CANG", "FEDU", "PSQH", "AHT", "CCM", "FENG", "NTZ",
    "EQS", "MOGU", "SLAI", "MVO", "SOS", "MTR", "BF-B", "BF-A", "HEI-A", "CRD-A",
)

assert_unique_universe("NYSE_EXPANSION", NYSE_EXPANSION, expected=1500)
