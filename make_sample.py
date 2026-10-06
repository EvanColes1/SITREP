"""Writes SAMPLE data so the dashboard can be previewed before the live collector has run.

Every file is marked "sample": true and the dashboard shows a banner while it is in use.
The first real collector run overwrites all of it.
"""
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "collector"))
from collect import Tagger, save_meta  # noqa: E402

OUT = ROOT / "site" / "data"
OUT.mkdir(parents=True, exist_ok=True)
random.seed(7)
NOW = datetime.now(timezone.utc)

HEADLINES = [
    ("Treasury sanctions tankers linked to Russia's shadow fleet", "OFAC designated vessels and ship managers accused of moving Russian crude above the price cap.", "Sanctions"),
    ("UK adds ship-to-ship transfer operators to sanctions list", "OFSI asset freeze targets firms in the UAE handling Russian oil cargoes.", "Sanctions"),
    ("EU agrees new sanctions package targeting LNG and shipping", "The package lists further vessels and restricts port access across the bloc.", "Sanctions"),
    ("Houthi missile strikes cargo ship in Red Sea", "The attack off Yemen forced the crew to abandon ship and rerouted traffic around the Cape.", "Maritime"),
    ("Insurers raise war-risk premiums for Strait of Hormuz transits", "P&I clubs cite rising tension between Iran and Gulf states.", "Maritime"),
    ("Baltic states inspect tanker after undersea cable damage", "Estonia and Finland detained a vessel suspected of dragging its anchor near Tallinn.", "Maritime"),
    ("Philippines and China trade accusations over South China Sea collision", "Coast guard vessels collided near a disputed shoal off Manila's claimed waters.", "Maritime"),
    ("Brent crude rises as OPEC+ signals deeper output cuts", "Oil prices climbed after Saudi Arabia said the group would extend cuts into next year.", "Energy"),
    ("Europe gas prices jump on Norwegian outage", "A pipeline fault cut flows to Germany as storage drawdowns accelerate.", "Energy"),
    ("India's purchases of Russian crude hit record high", "Discounted Urals barrels continue to flow to Indian refineries.", "Energy"),
    ("Kazakhstan pipeline exports disrupted after drone attack", "The Caspian Pipeline Consortium terminal near the Black Sea suspended loadings.", "Energy"),
    ("China tightens export controls on rare earth processing technology", "Beijing's move follows new US curbs on advanced semiconductors.", "Trade"),
    ("US announces tariffs on steel imports from Mexico and Canada", "The White House said the tariffs respond to rising import volumes.", "Trade"),
    ("EU and Mercosur sign long-delayed trade agreement", "The deal faces opposition from French farmers ahead of ratification.", "Trade"),
    ("Ukraine strikes refinery deep inside Russia with long-range drones", "Kyiv said the attack hit a facility supplying fuel to the front line.", "Conflict"),
    ("Russian offensive presses towards Pokrovsk as ceasefire talks stall", "Ukrainian troops report heavy shelling across Donetsk.", "Conflict"),
    ("Israel and Hezbollah exchange fire across Lebanon border", "Airstrikes hit southern Lebanon after rockets were fired at northern Israel.", "Conflict"),
    ("RSF fighters seize town in Sudan's Darfur region", "Thousands fled as clashes with the army spread across Darfur.", "Conflict"),
    ("M23 rebels advance near Goma in eastern DR Congo", "Rwanda denies supporting the armed group as fighting displaces civilians.", "Conflict"),
    ("Jihadist attack kills soldiers in Burkina Faso", "The junta said militants struck a military post in the Sahel border region.", "Conflict"),
    ("Pakistan and India trade fire along Kashmir line of control", "Both militaries reported shelling after an attack on troops.", "Conflict"),
    ("Georgia's ruling party wins disputed election as protests grow", "Opposition supporters rallied in Tbilisi, alleging fraud.", "Politics"),
    ("Moldova votes in parliamentary election amid Russian interference claims", "Officials in Chisinau warned of vote-buying schemes.", "Politics"),
    ("Coup attempt foiled in Guinea-Bissau, government says", "Soldiers were arrested after gunfire near the presidential palace.", "Politics"),
    ("Thousands protest in Serbia against government corruption", "Demonstrators in Belgrade demanded the resignation of ministers.", "Politics"),
    ("Venezuela's opposition leader calls for international pressure on Maduro", "Caracas faces renewed scrutiny over election results.", "Politics"),
    ("Thailand's prime minister faces no-confidence vote", "Parliament in Bangkok will debate the motion next week.", "Politics"),
    ("Ransomware attack disrupts European airport check-in systems", "Hackers targeted a software supplier used at Brussels and Berlin airports.", "Cyber"),
    ("North Korean hackers stole $1bn in crypto this year, report says", "Investigators link the thefts to Pyongyang's weapons programme.", "Cyber"),
    ("Chinese espionage group targets Taiwan semiconductor firms", "Security researchers say the campaign used zero-day exploits.", "Cyber"),
    ("Record number of migrants cross the Channel in small boats", "The UK government faces pressure over asylum processing.", "Migration"),
    ("UNHCR warns of funding gap as Sudan refugees reach Chad", "More than 600,000 displaced people have crossed the border.", "Migration"),
    ("US expands deportation flights to Central America", "Guatemala and Honduras received the first flights under the new agreement.", "Migration"),
    ("Drought threatens Panama Canal shipping capacity", "Low water levels forced authorities to restrict daily transits.", "Climate"),
    ("Floods displace hundreds of thousands in Nigeria", "Heavy rains caused a dam to overflow in the north-east.", "Climate"),
    ("Heatwave and wildfires hit grain output in southern Russia", "Food security concerns grow as export forecasts are cut.", "Climate"),
    ("Iran expands uranium enrichment, IAEA report says", "Inspectors found stockpiles of enriched uranium near weapons grade.", "Nuclear"),
    ("Russia suspends participation in remaining arms control talks", "Moscow said New START limits no longer apply.", "Nuclear"),
    ("North Korea tests new ICBM capable of reaching US mainland", "Japan and South Korea condemned the launch.", "Nuclear"),
    ("UN Security Council deadlocked over Gaza ceasefire resolution", "The US vetoed the draft as humanitarian conditions worsen.", "Global"),
    ("G7 leaders pledge to tighten enforcement of Russian oil price cap", "The statement names shadow fleet insurers and flag registries.", "Global"),
    ("IMF cuts global growth forecast citing trade tensions", "The fund warned tariffs and conflict could slow recovery.", "Global"),
    ("Azerbaijan and Armenia sign framework peace agreement", "The deal in Baku follows decades of conflict over Nagorno-Karabakh.", "Politics"),
    ("Turkey brokers grain shipping talks between Russia and Ukraine", "Ankara hopes to restore safe passage in the Black Sea.", "Maritime"),
    ("Saudi Aramco cuts oil prices for Asian buyers", "The move signals weaker demand in China.", "Energy"),
]

TEMPLATES = {
    "sanctions": ["{c} firms added to US sanctions list over {x}", "UK freezes assets of {c} network linked to {x}", "EU targets {c} shipping companies in new sanctions package", "Treasury designates {c} traders for sanctions evasion"],
    "energy": ["{c} oil exports climb as buyers chase discounted crude", "Gas pipeline outage in {c} lifts European prices", "{c} signs LNG supply deal amid energy security push", "Refinery fire in {c} disrupts fuel supply"],
    "maritime": ["Tanker seized off {c} coast amid shadow fleet crackdown", "Shipping insurers raise premiums for {c} port calls", "{c} navy shadows vessels near disputed waters", "Drone strike hits cargo ship near {c}"],
    "conflict": ["Fighting intensifies in {c} as ceasefire talks stall", "Airstrikes kill dozens in {c}, officials say", "Militants attack army post in {c}", "Troops deployed to {c} border after clashes"],
    "politics": ["Protests spread in {c} ahead of disputed election", "{c} president faces impeachment vote", "Opposition leader arrested in {c} as crackdown widens", "{c} parliament dissolved amid political crisis"],
    "trade": ["{c} hit by new tariffs on steel and aluminium", "{c} tightens export controls on critical minerals", "Supply chain disruption in {c} hits semiconductor output", "{c} and EU open trade talks"],
    "cyber": ["Ransomware attack hits {c} government systems", "Hackers linked to {c} target European energy firms", "{c} accuses rival of cyber espionage campaign", "Data breach exposes millions of records in {c}"],
    "migration": ["Thousands displaced by fighting cross into {c}", "{c} tightens asylum rules as migrant arrivals rise", "UN warns of refugee crisis on {c} border", "{c} expands deportation flights"],
    "climate": ["Drought threatens harvests across {c}", "Floods displace thousands in {c}", "Heatwave strains power grid in {c}", "Cyclone makes landfall in {c}"],
    "nuclear": ["{c} expands uranium enrichment, inspectors say", "{c} tests ballistic missile in show of deterrence", "Arms control talks with {c} collapse", "IAEA visits {c} nuclear site"],
}
HOT = {
    "sanctions": ["Russia", "Iran", "North Korea", "Belarus", "Venezuela", "China", "United Arab Emirates"],
    "energy": ["Russia", "Saudi Arabia", "Norway", "Qatar", "Iraq", "Nigeria", "Kazakhstan", "Libya", "India"],
    "maritime": ["Yemen", "Iran", "China", "Philippines", "Russia", "Estonia", "Egypt", "Taiwan"],
    "conflict": ["Ukraine", "Russia", "Sudan", "Israel", "Lebanon", "Myanmar", "Mali", "Burkina Faso", "Somalia", "Syria", "Pakistan", "Colombia"],
    "politics": ["Georgia", "Serbia", "Venezuela", "Bangladesh", "Kenya", "France", "Thailand", "Moldova", "Turkey", "Argentina"],
    "trade": ["China", "Mexico", "Canada", "Japan", "India", "Vietnam", "Germany", "Brazil"],
    "cyber": ["China", "Russia", "North Korea", "Iran", "Germany", "Japan"],
    "migration": ["Chad", "Poland", "Italy", "Greece", "Mexico", "Bangladesh", "Libya"],
    "climate": ["Pakistan", "Nigeria", "Brazil", "Philippines", "Ethiopia", "Australia", "Spain"],
    "nuclear": ["Iran", "North Korea", "Russia", "China", "India"],
}
EXTRA = ["oil smuggling", "drone parts", "arms procurement", "crypto laundering", "dual-use exports"]

SOURCES = ["BBC World", "Al Jazeera", "The Guardian World", "DW", "RFE/RL", "gCaptain", "OilPrice.com", "Crisis Group", "The Record", "The Diplomat"]


def news():
    tagger = Tagger()
    items = []
    for i, (title, summary, _) in enumerate(HEADLINES):
        t = NOW - timedelta(hours=random.uniform(1, 24 * 6))
        items.append({"id": f"sample{i}", "title": title, "summary": summary, "url": "#",
                      "source": random.choice(SOURCES), "group": "Sample", "published": t.isoformat(),
                      **tagger.tag(title, summary, {})})
    n = 0
    for theme, temps in TEMPLATES.items():
        # recent weeks are busier for some themes so the trend charts show movement
        weight = {"maritime": 1.6, "conflict": 1.8, "sanctions": 1.4, "energy": 1.3}.get(theme, 1.0)
        for _ in range(int(26 * weight)):
            c = random.choice(HOT[theme])
            title = random.choice(temps).format(c=c, x=random.choice(EXTRA))
            if any(it["title"] == title for it in items):
                continue
            days_back = random.triangular(0, 14, 0 if weight > 1.2 else 10)
            t = NOW - timedelta(days=days_back, hours=random.uniform(0, 3))
            items.append({"id": f"gen{n}", "title": title, "summary": "Sample story generated for the preview.", "url": "#",
                          "source": random.choice(SOURCES), "group": "Sample", "published": t.isoformat(),
                          **tagger.tag(title, "", {})})
            n += 1
    # a burst in the last 24 hours so the Signals panel has something to show
    burst = [("Houthi drones target tanker in Red Sea", "Yemen"), ("Red Sea transits fall as insurers pull cover", "Yemen"),
             ("Second ship hit near Bab el-Mandeb in 24 hours", "Yemen"), ("US Navy intercepts missiles over Red Sea", "Yemen"),
             ("Shipping giants pause Red Sea routes after attacks", "Egypt"), ("Suez Canal revenue slumps as ships divert", "Egypt"),
             ("Houthi leader vows more strikes on shipping", "Yemen"), ("Red Sea crisis lifts container freight rates", "Yemen"),
             ("Venezuela election protests turn deadly in Caracas", "Venezuela"), ("Maduro declares state of emergency", "Venezuela"),
             ("Venezuela opposition calls general strike", "Venezuela"), ("Venezuela troops deployed to Caracas streets", "Venezuela")]
    for k, (title, _) in enumerate(burst):
        t = NOW - timedelta(hours=random.uniform(0.5, 20))
        items.append({"id": f"burst{k}", "title": title, "summary": "Sample story generated for the preview.", "url": "#",
                      "source": random.choice(SOURCES), "group": "Sample", "published": t.isoformat(), **tagger.tag(title, "", {})})
    items.sort(key=lambda x: x["published"], reverse=True)
    return {"sample": True, "updated": NOW.isoformat(), "items": items}


def sanctions():
    flags = ["pa", "pa", "cm", "cm", "ga", "km", "sl", "ck", "pw", "ru", "ir"]
    vessels = []
    for i in range(120):
        d = (NOW - timedelta(days=random.randint(0, 200))).date().isoformat()
        vessels.append({"name": f"SAMPLE VESSEL {i+1}", "type": "Vessel", "countries": random.choice(flags),
                        "programs": random.choice(["US OFAC", "UK OFSI", "EU", "US OFAC; UK OFSI; EU"]),
                        "datasets": "", "first_seen": d, "id": f"s{i}", "imo": str(9100000 + i * 137)})
    vessels.sort(key=lambda v: v["first_seen"], reverse=True)
    recent = []
    for i in range(25):
        d = (NOW - timedelta(days=random.randint(0, 29))).date().isoformat()
        recent.append({"name": f"Sample entity {i+1}", "type": random.choice(["Company", "Person", "Vessel"]),
                       "countries": random.choice(["ru", "ir", "ae", "cn", "kp", "by"]),
                       "programs": random.choice(["US OFAC", "UK OFSI", "EU"]), "first_seen": d, "id": f"r{i}"})
    recent.sort(key=lambda v: v["first_seen"], reverse=True)
    return {"sample": True, "updated": NOW.isoformat(), "recent": recent, "recent_total": 214,
            "vessels": vessels, "vessel_total": 1180}


def energy():
    out = {"sample": True, "updated": NOW.isoformat(), "series": {}}
    for label, start, vol in (("Brent crude ($/bbl)", 78, 1.2), ("WTI crude ($/bbl)", 74, 1.2), ("Henry Hub gas ($/MMBtu)", 2.9, 0.08)):
        v, pts = start, []
        for d in range(120, 0, -1):
            day = NOW - timedelta(days=d)
            if day.weekday() >= 5:
                continue
            v = max(0.5, v + random.gauss(0, vol))
            pts.append({"date": day.date().isoformat(), "value": round(v, 2)})
        out["series"][label] = pts
    return out


def conflict():
    spots = [("Ukraine", 48.3, 37.6, "Battles"), ("Sudan", 13.5, 25.3, "Battles"), ("Myanmar", 21.0, 95.9, "Battles"),
             ("Nigeria", 11.8, 13.1, "Violence against civilians"), ("Burkina Faso", 13.3, -1.5, "Violence against civilians"),
             ("DR Congo", -1.6, 29.2, "Battles"), ("Palestine", 31.4, 34.4, "Explosions/Remote violence"),
             ("Lebanon", 33.3, 35.4, "Explosions/Remote violence"), ("Mexico", 20.6, -103.3, "Violence against civilians"),
             ("Serbia", 44.8, 20.4, "Protests"), ("Georgia", 41.7, 44.8, "Protests"), ("Kenya", -1.3, 36.8, "Riots"),
             ("Pakistan", 30.2, 67.0, "Explosions/Remote violence"), ("Haiti", 18.5, -72.3, "Violence against civilians"),
             ("Colombia", 7.1, -73.1, "Battles"), ("Bangladesh", 23.8, 90.4, "Protests"), ("Yemen", 15.4, 44.2, "Explosions/Remote violence"), ("Venezuela", 10.5, -66.9, "Protests")]
    events = []
    for c, la, lo, typ in spots:
        for _ in range(random.randint(3, 14)):
            events.append({"date": (NOW - timedelta(days=random.randint(0, 13))).date().isoformat(), "type": typ, "sub_type": "",
                           "country": c, "region": "", "location": c, "lat": la + random.uniform(-1.5, 1.5),
                           "lon": lo + random.uniform(-1.5, 1.5), "fatalities": random.choice([0, 0, 0, 1, 2, 5, 12]),
                           "notes": "Sample event for preview."})
    return {"sample": True, "updated": NOW.isoformat(), "events": events}


def status():
    feeds = [{"name": s, "group": "Sample", "ok": True, "new": random.randint(2, 30), "note": ""} for s in SOURCES]
    feeds.append({"name": "Example broken feed", "group": "Sample", "ok": False, "new": 0, "note": "404 Not Found"})
    return {"sample": True, "updated": NOW.isoformat(), "feeds": feeds,
            "data": [{"name": n, "ok": True, "note": ""} for n in ("sanctions", "energy", "conflict")]}


for name, fn in (("news", news), ("sanctions", sanctions), ("energy", energy), ("conflict", conflict), ("status", status)):
    (OUT / f"{name}.json").write_text(json.dumps(fn(), ensure_ascii=False, indent=1), encoding="utf-8")
save_meta()
print("Sample data written to", OUT)
