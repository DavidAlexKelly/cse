// ============================================================
// Detail page content for each task node — extracted from HTML
// ============================================================

export interface Comment {
  initials: string;
  name: string;
  time: string;
  text: string;
}

export interface TableRow {
  cells: string[];
}

export interface ContentSection {
  type: "hero" | "text" | "badges" | "table" | "timeline" | "placeholder";
  title?: string;
  subtitle?: string;
  generated?: boolean; // AI generated flag
  body?: string;
  badges?: string[];
  columns?: string[];
  rows?: TableRow[];
  items?: TimelineItem[];
  tag?: string;
}

export interface TimelineItem {
  day: string;
  title: string;
  body: string;
  tag: string;
}

export interface TaskPageContent {
  taskTitle: string;
  taskAssignment: string;
  approvalStatus: string;
  sections: ContentSection[];
  comments: Comment[];
}

// ── Scenario ───────────────────────────────────────────────────────────
export const scenarioPage: TaskPageContent = {
  taskTitle: "Define & review scenario",
  taskAssignment:
    "Assigned to you by Col Anderssen · Due D-55 · Review strategic context, OPFOR definition, and exercise area narrative",
  approvalStatus: "Approved by BGen Hartmann · 2 Jun 2025",
  sections: [
    {
      type: "text",
      title: "Strategic context",
      generated: true,
      subtitle: "The Sorvian Peninsula Crisis",
      body: "The fictional state of Sorvia, bordering the Eastern Flank, has experienced rapid deterioration of the security environment following contested elections and external interference by the Dorvian Federation. NATO has activated Article 4 consultations and deployed a Multinational Division to the region. The exercise begins at D-Day with the division assuming operational control of the assigned area under conditions of a high-intensity conventional threat combined with significant information operations and cyber activity targeting allied C2 nodes.",
      badges: [
        "High intensity",
        "Information ops",
        "Eastern Flank",
        "Article 4",
      ],
    },
    {
      type: "hero",
      title: "OPFOR definition",
      generated: true,
      subtitle: "Dorvian 3rd Combined Arms Army",
      body: "Combined arms force with integrated air defence, EW, and cyber capabilities. Manoeuvre-heavy doctrine with strong ISR and long-range fires. Will challenge BLUFOR across all functional areas simultaneously.",
      badges: ["Near-peer", "EW + Cyber", "Long-range fires"],
    },
    {
      type: "text",
      title: "Asymmetric threat cells",
      subtitle: "Information environment",
      body: "Proxy forces conducting information operations, sabotage of LOCs, and civilian population influence. Active disinformation campaign targeting NATO public opinion and allied cohesion.",
      badges: ["IO/PSYOPS", "CIMIC impact"],
    },
  ],
  comments: [
    {
      initials: "AL",
      name: "Col Anderssen",
      time: "Yesterday 16:42",
      text: "OPFOR definition looks solid. Please ensure the cyber element is coordinated with J6 — they flagged that the C2 node targeting should reference specific systems in the scenario.",
    },
    {
      initials: "MK",
      name: "LtCol Kowalski",
      time: "Today 08:30",
      text: "Updated — referenced SATCOM and primary HF nets as the targeted systems. Also expanded the proxy forces section per the EXDIR guidance.",
    },
  ],
};

// ── Training Audience ──────────────────────────────────────────────────
export const trainingAudiencePage: TaskPageContent = {
  taskTitle: "Define training audience",
  taskAssignment:
    "Assigned to Col Anderssen · Due D-65 · Define who the exercise trains — primary and secondary audiences, nations, and participant numbers",
  approvalStatus: "Submitted for approval · Awaiting BGen Hartmann",
  sections: [
    {
      type: "hero",
      title: "Primary training audience",
      subtitle: "Multinational Division HQ Staff",
      body: "Full J1–J9 directorate staff from all five participating nations. The primary exercise audience covers all HQ functions including operations, intelligence, logistics, plans, fires, CIMIC, and communications.",
      badges: ["Primary", "~420 participants", "J1–J9"],
    },
    {
      type: "table",
      title: "Secondary audiences",
      columns: ["Unit", "Type", "Participants", "Focus"],
      rows: [
        {
          cells: [
            "J3 Operations Branch",
            "Secondary",
            "~80",
            "Battle rhythm, decision cycle, joint fires",
          ],
        },
        {
          cells: [
            "J2 Intelligence Branch",
            "Secondary",
            "~40",
            "INTSUM production, ISR coordination",
          ],
        },
        {
          cells: [
            "J4 Logistics Branch",
            "Secondary",
            "~55",
            "Sustainment planning, supply chain",
          ],
        },
        {
          cells: [
            "J6 Communications",
            "Secondary",
            "~25",
            "C2 continuity, PACE plan under cyber-degraded conditions",
          ],
        },
      ],
    },
    {
      type: "table",
      title: "Participating nations",
      columns: ["Nation", "Role", "Est. participants", "Key directorates"],
      rows: [
        {
          cells: [
            "Germany (DEU)",
            "Lead nation",
            "~180",
            "J3, J4, J5, HQ Cdr",
          ],
        },
        { cells: ["Poland (POL)", "Participant", "~80", "J2, J3, J9"] },
        {
          cells: [
            "United Kingdom (GBR)",
            "Participant",
            "~65",
            "J3, J5, Fires",
          ],
        },
        {
          cells: ["Norway (NOR)", "Participant", "~55", "J2, J4, Arty"],
        },
        {
          cells: [
            "Netherlands (NLD)",
            "Participant",
            "~40",
            "J6, Eng, J1",
          ],
        },
      ],
    },
  ],
  comments: [],
};

// ── Composition (PMESII Variables) ─────────────────────────────────────
export const pmesiiPage: TaskPageContent = {
  taskTitle: "Define & review PMESII variables",
  taskAssignment:
    "Assigned to Maj Westergaard · Due D-45 · 5 of 8 domains complete — Political, Military, Economic, Social, Infrastructure",
  approvalStatus: "Submitted for approval · Awaiting Col Anderssen",
  sections: [
    {
      type: "table",
      title: "PMESII-PT domains",
      generated: true,
      columns: ["Domain", "Description", "Status"],
      rows: [
        {
          cells: [
            "Political",
            "Government in exile. Contested sovereignty. Regional neighbours divided. UN Security Council deadlocked.",
            "Complete",
          ],
        },
        {
          cells: [
            "Military",
            "Near-peer OPFOR. Asymmetric threat cells. Friendly forces at 85% readiness. Air domain contested.",
            "Complete",
          ],
        },
        {
          cells: [
            "Economic",
            "Critical infrastructure disrupted. Port operations at 40% capacity. Fuel supply degraded by OPFOR interdiction.",
            "Complete",
          ],
        },
        {
          cells: [
            "Social",
            "IDPs: ~180,000. Hostile media environment. Pro-Dorvian population 30% in eastern AOR.",
            "Complete",
          ],
        },
        {
          cells: [
            "Infrastructure",
            "Road network degraded in sectors 3–4. 2 bridges destroyed. Rail LOC operational with restrictions.",
            "Complete",
          ],
        },
        {
          cells: [
            "Information",
            "Draft: Active disinformation campaign. C2 nodes targeted. Needs J6 coordination.",
            "In review",
          ],
        },
        {
          cells: [
            "Physical env.",
            "Not defined yet — terrain, weather, and environmental conditions.",
            "Empty",
          ],
        },
        {
          cells: [
            "Time",
            "Not defined yet — time constraints and decision windows.",
            "Empty",
          ],
        },
      ],
    },
  ],
  comments: [
    {
      initials: "AL",
      name: "Col Anderssen",
      time: "Today 07:45",
      text: "Information domain needs J6 input before we can approve. Physical environment and Time domains still empty — please complete before submitting.",
    },
  ],
};

// ── Training Objectives ────────────────────────────────────────────────
export const trainingObjectivesPage: TaskPageContent = {
  taskTitle: "Define & review training objectives",
  taskAssignment:
    "8 objectives defined across J-directorates",
  approvalStatus: "Approved by BGen Hartmann · 1 Jun 2025 · No further action required",
  sections: [
    {
      type: "table",
      title: "Training objectives",
      generated: true,
      columns: ["Ref", "Objective", "Functional area", "Priority"],
      rows: [
        {
          cells: [
            "TO-01",
            "Exercise HQ battle rhythm and decision cycle under degraded communications",
            "C2",
            "High",
          ],
        },
        {
          cells: [
            "TO-02",
            "Integrate multinational staff across all functional areas with full interoperability",
            "Staff integration",
            "High",
          ],
        },
        {
          cells: [
            "TO-03",
            "Conduct joint fires planning and coordination including air-land integration",
            "Fires",
            "High",
          ],
        },
        {
          cells: [
            "TO-04",
            "Execute sustainment planning across a 14-day high-intensity campaign",
            "Logistics",
            "Medium",
          ],
        },
        {
          cells: [
            "TO-05",
            "Respond to cyber incidents affecting C2 nodes and ISR assets",
            "Cyber / IM",
            "High",
          ],
        },
        {
          cells: [
            "TO-06",
            "Coordinate CIMIC activities and manage civilian-military interface in AOR",
            "CIMIC",
            "Medium",
          ],
        },
        {
          cells: [
            "TO-07",
            "Produce and disseminate intelligence products to support manoeuvre decisions",
            "Intelligence",
            "Medium",
          ],
        },
        {
          cells: [
            "TO-08",
            "Conduct media operations and strategic communication under information pressure",
            "STRATCOM",
            "Low",
          ],
        },
      ],
    },
  ],
  comments: [],
};

// ── Exercise Area ──────────────────────────────────────────────────────
export const exerciseAreaPage: TaskPageContent = {
  taskTitle: "Define exercise area",
  taskAssignment:
    "Search for a country or region, then adjust the AOR on the map. Add key terrain features below.",
  approvalStatus: "Submitted · Awaiting approval",
  sections: [
    {
      type: "placeholder",
      title: "Exercise area map",
      body: "N 54.0000° E 015.0000° — EXERCISE AREA — IRON FORGE 26",
    },
    {
      type: "table",
      title: "Key terrain features",
      columns: ["Name", "Type"],
      rows: [
        { cells: ["PORT SOVA", "LOC hub"] },
        { cells: ["RIDGELINE AMBER", "Dominant ground"] },
        { cells: ["BRIDGE CLUSTER DELTA", "Crossing sites"] },
      ],
    },
  ],
  comments: [],
};

// ── MEL / MIL ──────────────────────────────────────────────────────────
export const melMilPage: TaskPageContent = {
  taskTitle: "Review and validate MEL/MIL",
  taskAssignment:
    "Assigned to LtCol Kowalski · Due D-30 · 47 injects generated — review for realism, sequencing, and training load balance",
  approvalStatus: "Submitted for approval · Awaiting Col Anderssen",
  sections: [
    {
      type: "timeline",
      title: "Master events list — 47 injects",
      generated: true,
      items: [
        {
          day: "D+0",
          title: "OPFOR crossing of PHASE LINE ODIN detected",
          body: "ISR assets report battalion-sized element crossing in sector 2. Triggers INTSUM and fires request.",
          tag: "INTEL",
        },
        {
          day: "D+1",
          title: "Cyber attack on HQ communications node",
          body: "Primary C2 link degraded to 30% capacity. Backup PACE plan must be activated within 4 hours.",
          tag: "CYBER",
        },
        {
          day: "D+2",
          title: "IDP column blocks Route AMBER",
          body: "~4,200 IDPs moving west on primary supply route. CIMIC and MP coordination required.",
          tag: "CIMIC",
        },
        {
          day: "D+3",
          title: "Weather degradation — reduced air support window",
          body: "Ceiling at 300ft. All CAS sorties cancelled for 18-hour period. Ground-based fires only.",
          tag: "METOC",
        },
        {
          day: "D+5",
          title: "OPFOR SOF element identified in rear area",
          body: "HUMINT: 6-person team targeting fuel depot. Counter-SOF response required within 2 hours.",
          tag: "INTEL",
        },
        {
          day: "D+7",
          title: "Political event — NATO FM emergency session",
          body: "New ROE issued following political decision. Division must implement updated ROE within 6 hours.",
          tag: "POLMIL",
        },
        {
          day: "D+9",
          title: "Logistics crisis — fuel reserves at 15%",
          body: "Resupply convoy delayed 48h. Priority allocation required. Combat power vs sustainment trade-off.",
          tag: "LOG",
        },
        {
          day: "D+12",
          title: "OPFOR ceasefire offer — information operation",
          body: "Media reports ceasefire proposal. STRATCOM and legal must respond within 3 hours. Likely IO deception.",
          tag: "INFO OPS",
        },
      ],
    },
  ],
  comments: [],
};

// ── ORBAT & Positions ──────────────────────────────────────────────────
export const orbatPositionsPage: TaskPageContent = {
  taskTitle: "Define ORBAT & start positions",
  taskAssignment:
    "Assigned to Maj Roos · Due D-21 · Build force structure, then assign start positions on the map",
  approvalStatus: "Submitted · Awaiting approval",
  sections: [
    {
      type: "text",
      title: "ORBAT",
      body: "6 units defined. Click units in the library to add to the force structure.",
      badges: ["6 units", "0 / 6 placed"],
    },
    {
      type: "placeholder",
      title: "Start positions map",
      body: "N 54.0000° E 018.0000° — START POSITIONS — IRON FORGE 26",
    },
  ],
  comments: [],
};

// ── Composition page ───────────────────────────────────────────────────
export const compositionPage: TaskPageContent = {
  taskTitle: "Define simulation composition",
  taskAssignment:
    "Assigned to Col Anderssen · Due D-50 · Define which simulation systems, C2 nodes, and federation architecture constitute the exercise environment",
  approvalStatus: "Submitted for approval · Awaiting BGen Hartmann",
  sections: [
    {
      type: "text",
      title: "Federation architecture",
      subtitle: "Primary federation protocol",
      body: "IEEE 1516 High Level Architecture (HLA) — Evolved. All constructive simulation nodes federate via a central RTI. DIS IEEE 1278.1 used for legacy node compatibility. Link 16 / TADIL J for live and virtual tactical data link integration.",
      badges: ["HLA Evolved", "DIS IEEE 1278.1", "Link 16 / TADIL J"],
    },
    {
      type: "text",
      title: "Federation topology",
      subtitle: "Network architecture",
      body: "Star topology with central RTI hosted at HQ LANDCOM. National simulation nodes connect via dedicated MPLS links over the NATO Unclassified network. C2 systems connect via standardised NFFI/JC3IEDM data exchange.",
      badges: ["Star topology", "NFFI/JC3IEDM", "MPLS"],
    },
    {
      type: "table",
      title: "Constructive simulation nodes",
      columns: ["System", "Nation", "Type", "Aggregation level", "Protocol", "Status"],
      rows: [
        { cells: ["TLS-GO", "DEU", "Constructive", "Aggregated", "HLA", "Confirmed"] },
        { cells: ["Ascot7", "GBR", "Constructive", "Aggregated", "HLA / DIS", "Confirmed"] },
        { cells: ["VBS4 (Virtual Battlespace 4)", "GBR / NLD", "Virtual", "Entity-level", "DIS / HLA", "Confirmed"] },
        { cells: ["MASA SWORD", "FRA / POL", "Constructive", "Aggregated", "HLA", "Pending"] },
      ],
    },
    {
      type: "table",
      title: "C2 information systems (CCIS)",
      columns: ["System", "Nation / org", "Function", "Interface", "Status"],
      rows: [
        { cells: ["TOPFAS", "NATO", "Operational planning & orders", "JC3IEDM / NFFI", "Connected"] },
        { cells: ["FACETS", "DEU", "Force tracking & COP", "NFFI", "Connected"] },
        { cells: ["BMS Aquila", "POL", "Battlefield management", "Link 16 / DIS", "In test"] },
        { cells: ["Battlespace Next (BSpN)", "GBR", "Tactical C2 & COP", "NFFI / Link 16", "In test"] },
      ],
    },
    {
      type: "text",
      title: "Terrain server",
      subtitle: "VR-TheWorld / STAGE",
      body: "Shared correlated terrain database covering the Sorvian Peninsula AOR. Hosted at central simulation node. Distributed to all federated simulators via HLA terrain services object model.",
      badges: ["VR-TheWorld", "Shared terrain"],
    },
    {
      type: "text",
      title: "After Action Review system",
      subtitle: "JLCCTC AAR / BML Logger",
      body: "All federation traffic logged via passive HLA logger for post-exercise AAR playback. BML message logging captures all C2 transactions for exercise analysis and lessons learned.",
      badges: ["HLA logger", "BML capture"],
    },
  ],
  comments: [],
};

// ── Node ID → page content map ─────────────────────────────────────────
export const pageContentMap: Record<string, TaskPageContent> = {
  scenario: scenarioPage,
  "training-audience": trainingAudiencePage,
  "pmesi-variables": pmesiiPage,
  "training-objectives": trainingObjectivesPage,
  "exercise-area": exerciseAreaPage,
  "mel-mil": melMilPage,
  "orbat-positions": orbatPositionsPage,
};
