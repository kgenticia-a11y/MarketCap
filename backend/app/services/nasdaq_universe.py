"""
Nasdaq expansion universe — 1,000 additional Nasdaq-listed common stocks.

Selection (2026-07-14): every symbol in the official Nasdaq listing
directory (NASDAQ Trader symbol directory / NASDAQ stock-screener feed,
exchange=Nasdaq), filtered to common stocks only — preferred shares, warrants,
rights (suffix W/U), SPAC units, notes/debentures, closed-end funds and ETFs
are excluded; Nasdaq-listed ADS commons and class-share commons are kept —
then the 1,000 largest by market cap that are not already in the core 599-stock
universe in market_data.py or the 1,500-stock NYSE expansion in nyse_universe.py.

Ordered largest market cap first. Symbols use Yahoo Finance notation
(class shares use a dash: GOOG, not GOOG.C) because every fetch path goes
through yfinance. Nasdaq-only by construction — do not add NYSE/AMEX symbols
here; those belong in nyse_universe.py.

This list is a snapshot and goes stale as small caps delist or rename. Do
not edit it by hand — regenerate it (quarterly is plenty) with:
    python3 scripts/refresh_nasdaq_universe.py
and review the resulting diff like any code change.
"""

from app.services.nyse_universe import assert_unique_universe

NASDAQ_EXPANSION: tuple[str, ...] = (
    "GOOG", "SPCX", "SNDK", "MRVL", "APP", "SNY", "NTES", "CTAS", "HONA", "ALAB",
    "ARGX", "NBIS", "TER", "MDLN", "EXC", "CCEP", "FER", "CBRS", "CRWV", "ADSK",
    "AXON", "TRI", "PAYX", "ERIC", "UAL", "RVMD", "NTRA", "BIDU", "ALNY", "VOD",
    "KMB", "GFS", "ESLT", "ONC", "RYAAY", "RPRX", "EXPE", "WTW", "SKHY", "ECHO",
    "JBHT", "TCOM", "ASTS", "TSEM", "SYM", "VRSK", "FWONK", "ROIV", "PFG", "FCNCA",
    "MKSI", "INIO", "WWD", "TW", "FWONA", "UTHR", "BNTX", "FTAI", "BSP", "GH",
    "CTSH", "EXE", "ENTG", "STRL", "TLN", "GMAB", "SITM", "EWBC", "LSCC", "ARXS",
    "BDRX", "NWS", "KSPI", "QNT", "PAA", "ASND", "RGLD", "SSNC", "AMKR", "TPG",
    "BBIO", "GRAB", "TIGO", "WSE", "LAMR", "CG", "HST", "NXT", "LOGI", "PTC",
    "NVMI", "CHKP", "TTMI", "EXEL", "COO", "LECO", "BTSG", "FUTU", "ARCC", "LI",
    "ICLR", "ZBRA", "TXRH", "AGNC", "HTHT", "MDGL", "TRMB", "IESC", "SMMT", "AUR",
    "COKE", "CSGP", "AXSM", "ABVX", "SEIC", "ENLT", "DRS", "SAIA", "VICR", "BMRN",
    "ERIE", "AEIS", "CART", "HAS", "FROG", "UMBF", "WTFC", "BPOP", "SANM", "AAL",
    "KRYS", "JKHY", "PSKY", "CGNX", "ARWR", "PAYP", "LFUS", "GSAT", "CYTK", "ONB",
    "SIMO", "APGE", "TEM", "LINE", "FRHC", "ENSG", "NUVL", "SFD", "SOLS", "LLYVK",
    "VIAV", "VSAT", "ALGM", "FCFS", "MANH", "LLYVA", "COLB", "CORT", "BRKR", "GLXY",
    "KYMR", "AAOI", "SNEX", "CRNX", "KTOS", "PRAX", "ALKS", "FORM", "CBSH", "XP",
    "TGTX", "BOKF", "PTGX", "GGAL", "SYRE", "APLD", "PCVX", "POWL", "MBLY", "RGEN",
    "IBRX", "TTEK", "VLY", "HQY", "MXL", "CHYM", "SAIL", "IMVT", "TTAN", "FRVO",
    "CBC", "QRVO", "CRUS", "LGN", "RYTM", "Z", "BILI", "MIRM", "LSTR", "CORZ",
    "SLAB", "VFS", "AVAV", "AVT", "PLXS", "LNTH", "PPC", "IDCC", "PTCT", "RRR",
    "PCTY", "NAVN", "BZ", "MORN", "FSV", "GDS", "FIGR", "SRRK", "CACC", "XENE",
    "GLBE", "LKQ", "MYRG", "COGT", "CGON", "CAMT", "APPF", "UBSI", "MMYT", "ACT",
    "LQDA", "XE", "CWST", "DSGX", "ACMR", "LGND", "HWC", "NICE", "MIDD", "CZR",
    "SSRM", "URBN", "OTEX", "MRCY", "PSMT", "GTX", "RUSHB", "MAAS", "SIGI", "RUSHA",
    "CHDN", "BLTE", "VSEC", "VCTR", "ACIW", "OZK", "DOX", "BLLN", "TWST", "LAUR",
    "KLIC", "ERAS", "REYN", "MWH", "CAR", "AMRX", "DNTH", "SEZL", "PECO", "TXG",
    "ROAD", "BGC", "FTDR", "TVTX", "GLNG", "BCPC", "SHC", "NTSK", "EBC", "OMAB",
    "STEP", "GNTX", "RGTI", "ORKA", "XMTR", "CELC", "IEP", "VSNT", "PTRN", "INDV",
    "PAGP", "DAVE", "RELY", "RDNT", "FFIN", "TFSL", "GRFS", "CIGI", "CRSP", "SRAD",
    "CAI", "MRX", "UFPI", "SAIC", "CECO", "LEGN", "WSC", "DFTX", "IBOC", "SLM",
    "KNSA", "FULT", "SYNA", "VCYT", "FELE", "LIVN", "OCTV", "MMED", "NWE", "HLNE",
    "CENX", "AUGO", "TCBI", "IPGP", "EWTX", "VKTX", "LBRDK", "WAY", "UCTT", "DLO",
    "MMSI", "ACAD", "DOO", "EXLS", "LBTYB", "OPEN", "EXTR", "CVCO", "ATAT", "COCO",
    "ALM", "EQPT", "DIOD", "LIF", "LFST", "ALHC", "DNLI", "ACLS", "WING", "DORM",
    "CATY", "LFTO", "TNGX", "CAKE", "LOPE", "WSFS", "MNDY", "INDB", "CLBT", "FRMI",
    "MAT", "CHEF", "CVBF", "PENG", "CALM", "OLLI", "MEOH", "ICUI", "USAR", "DYN",
    "IRTC", "BWIN", "NAMS", "LASR", "SKYW", "BULL", "POWI", "QS", "BANF", "CPRX",
    "VEON", "BHF", "IPAR", "FIBK", "WSBC", "OTTR", "TLX", "PLMR", "ITRI", "ONDS",
    "LBTYA", "BATRA", "GPCR", "NSIT", "CCC", "OLED", "FFBC", "JOYY", "MCHB", "RLAY",
    "ALMS", "FLY", "LBTYK", "VCRE", "FHB", "FA", "PBLS", "PRVA", "OSIS", "KYIV",
    "CLMT", "PPLI", "EMAT", "OPCH", "VECO", "ARQT", "WDFC", "BATRK", "GBDC", "ADPT",
    "BELFB", "SFNC", "ARCB", "AXTI", "LUNR", "RARE", "CSQ", "COLM", "CRVL", "SBCF",
    "BEAM", "ARLP", "IDYA", "AMBA", "NMIH", "ICHR", "FSLY", "XNDU", "MZTI", "KC",
    "ELVN", "ATRO", "SHOO", "NVTS", "AGYS", "EXPO", "NTCT", "GRAL", "ETOR", "ADEA",
    "PLUG", "CLDX", "MGEE", "FRSH", "VERA", "USLM", "SBLK", "EEFT", "TRMD", "MGNI",
    "HUBG", "FIZZ", "IRON", "PONY", "WIX", "ASO", "MGRC", "CHRN", "MBX", "NESR",
    "WAFD", "BELFA", "ACHC", "HWKN", "FLNC", "CDNL", "TBBK", "VC", "SUPN", "FRPT",
    "GCMG", "PATK", "PENN", "AYA", "VISN", "FRME", "TRMK", "STNE", "CENT", "AVPT",
    "OUST", "UNIT", "NMRK", "TOWN", "FBNC", "PLBL", "ASTH", "OSW", "WERN", "PTON",
    "NBTB", "KEEL", "PSNY", "TMDX", "HTO", "QURE", "KLRA", "ESTA", "KALU", "RUM",
    "ALRM", "IMNM", "KOD", "TARS", "ANDE", "DRVN", "BCRX", "PGNY", "RGC", "DGII",
    "INTR", "COHU", "HIMX", "DXPE", "BUSE", "SLDE", "PHVS", "DRH", "SLBT", "VCEL",
    "BLBD", "SKWD", "CMPR", "IMOS", "AGIO", "EFSC", "CLOV", "SHAZ", "PAYO", "BAND",
    "DJT", "NRIX", "CENTA", "PLUS", "SLS", "TRVI", "NYAX", "PPTA", "BANR", "SPSC",
    "NKTR", "PRDO", "LMAT", "MLYS", "HAPN", "SYBT", "HTFL", "IQMX", "RNW", "CHA",
    "INOD", "CLBK", "MLCO", "ZLAB", "MCRI", "NWBI", "INTA", "VNET", "MBIN", "NWL",
    "AEHR", "OCUL", "NEXT", "FLYW", "LCID", "OMCL", "DHC", "PDFS", "NN", "AVAH",
    "NEOG", "VERX", "AXGN", "PVLA", "MESO", "SGRY", "ADMA", "JBLU", "AUPH", "ANAB",
    "KARD", "HRMY", "ADUS", "SNDX", "IOSP", "ATEX", "EZPW", "SRPT", "SION", "CNXN",
    "FIVN", "ALGT", "SRCE", "BVC", "LKFT", "VRDN", "GSHD", "STGW", "ECPG", "HCM",
    "TYRA", "RAPP", "STRA", "AMLX", "MFP", "URGN", "WRD", "ABCL", "TCBK", "CASH",
    "EVCM", "ZD", "GT", "NCNO", "ALMR", "WGS", "NBTX", "ALKT", "CHCO", "WB",
    "CDZIP", "TILE", "HYMC", "GLUE", "BCAX", "COAG", "PGEN", "NEO", "UFPT", "STOK",
    "GENB", "ATAI", "AAPG", "ZYME", "ANIP", "NTLA", "XNET", "QUBT", "IOVA", "HURN",
    "PLSE", "SONO", "GABC", "CMPS", "KARO", "BL", "ATRC", "PAX", "ZBIO", "STBA",
    "MQ", "GHRS", "LIND", "RBCAA", "TMC", "DMRA", "IMKTA", "HOPE", "PRCH", "LINC",
    "FORTY", "OPRA", "FTRE", "PLAB", "TRIP", "TH", "PLPC", "LILA", "MPLT", "FSUN",
    "WLFC", "LIME", "LILAK", "HCSG", "MRVI", "BFC", "VIR", "INVA", "OPI", "AMSC",
    "FRMEP", "CNOB", "MAZE", "ITG", "QCRH", "OXLC", "ABSI", "WBTN", "FBYD", "TRIN",
    "BRUN", "SHLS", "PSNL", "PRGS", "AVBP", "SKYT", "PLTK", "IMCR", "HROW", "QFIN",
    "SEPN", "TSHA", "EYE", "HLMN", "EOSE", "PICS", "INNV", "TBLA", "CNXC", "AIP",
    "LKFN", "ULCC", "MLTX", "ATEC", "CDNA", "ALNT", "HLIT", "CSWC", "NVAX", "ATLC",
    "PGY", "GIII", "TRS", "IART", "KMTS", "JJSF", "NNNN", "ICFI", "WEN", "BLKB",
    "RMIX", "MRTN", "BHRB", "TWFG", "AKTS", "XERS", "PURR", "WYFI", "AHCO", "OMDA",
    "NICM", "AMAL", "MLKN", "PNTG", "PWP", "WINA", "STAA", "PEBO", "WABC", "BLFS",
    "TSAT", "WLTH", "INBX", "UFCS", "PCT", "LGIH", "PAHC", "CCEC", "YSWY", "BRAI",
    "LZ", "CTBI", "BJRI", "RDWR", "AFYA", "GCT", "SGML", "DMLP", "FCEL", "REAL",
    "FMBH", "NWPX", "ASTE", "DSGR", "NSSC", "ARDX", "IRMD", "MNKD", "AMPL", "HBNB",
    "IMTX", "CRVS", "AVLN", "UPBD", "NUTX", "XPEL", "HFWA", "SDGR", "ROCK", "POET",
    "IGIC", "TRAX", "QDEL", "LIFE", "UVSP", "GPRE", "LQDT", "PRCT", "WAFDP", "AZTA",
    "APPS", "CCB", "EYPT", "SENEA", "TRUP", "CAPR", "SENEB", "CEVA", "OSBC", "AEVA",
    "SVRA", "AVO", "CBRL", "CRTO", "HBT", "HTLD", "SBET", "RXT", "SVC", "WVE",
    "MGTX", "AIIR", "COLL", "PSEC", "UPWK", "SAFT", "TNDM", "ITRN", "XNCR", "THRM",
    "MGRT", "HQ", "OCFC", "NHP", "CGEM", "SCSC", "CRML", "ARHS", "PZZA", "CRAI",
    "IQ", "SIFY", "APEI", "ORIC", "ENVX", "WLDN", "CFFN", "SPTX", "EVLV", "DRTS",
    "LMRI", "NBN", "ASST", "OCSL", "HEPS", "CERT", "ALVO", "JBIO", "JCAP", "AOSL",
    "OLMA", "CRON", "MSEX", "GDRX", "RCAT", "SBGI", "ESQ", "ELVR", "MCBS", "ETON",
    "FSBC", "HBNC", "SANA", "CRSR", "JBSS", "QNST", "SCHL", "BVS", "ADTN", "PCRX",
    "CSIQ", "CCNE", "LWLG", "RZLV", "AVTX", "VMET", "BFST", "MBWM", "DGICB", "ELE",
    "ROOT", "JANX", "GO", "VOR", "DAKT", "PHAR", "BLZE", "KURA", "BIOA", "FRBT",
    "RDVT", "LXRX", "HAFC", "INMD", "BBSI", "SLDB", "TRST", "CRCT", "DBVT", "ARRY",
    "ACDC", "NBBK", "NNE", "ODD", "INDI", "KDK", "OPK", "HPK", "LBRX", "AEBI",
    "ANNX", "ABUS", "CAC", "AVR", "GERN", "WRLD", "ARKO", "GTM", "MOMO", "FBRX",
    "EVER", "ENRD", "IVA", "THFF", "GRPN", "BLDP", "GLIBA", "MPB", "GLIBK", "TALK",
    "HMH", "MITK", "LYTS", "LMB", "GILT", "TBPH", "TIGR", "PHAT", "ADSE", "DSGN",
    "TRNS", "FTH", "RJET", "HIVE", "FMNB", "AMPH", "CCBG", "ODTX", "GSBC", "DSP",
    "METC", "HSTM", "IPX", "REPL", "WOOF", "MATW", "FCBC", "SMBC", "KELYB", "PGC",
    "EGBN", "ESPR", "SPFI", "HCMA", "AHG", "ADAM", "APOG", "CTMX", "MFIC", "HDL",
    "DJCO", "ORRF", "TDUP", "NAVI", "CYRX", "SIBN", "HNRG", "ALRS", "ZVRA", "MAMA",
)

assert_unique_universe("NASDAQ_EXPANSION", NASDAQ_EXPANSION, expected=1000)
