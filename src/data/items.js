const itemsByDate = {
  "2026-03-18": [
    {
      id: 1,
      groupId: 1,
      title: "Mission-1",
      startMin: 6 * 60,
      endMin: 9 * 60,
      movable: true,
      lane: 0,
      color: "#ff6fb1",
      description: "Ana Görev (Parent). Bunu hareket ettirirseniz Mission-2 ve Mission-6 da hareket eder.",
      dependencies: []
    },
    {
      id: 2,
      groupId: 1,
      title: "Mission-2",
      startMin: 9 * 60,
      endMin: 10 * 60,
      movable: true,
      lane: 0,
      color: "#ff6fb1",
      description: "Mission-1'e bağlı.",
      dependencies: [1]
    },
    {
      id: 3,
      groupId: 1,
      title: "Mission-3",
      startMin: 7 * 60,
      endMin: 12 * 60,
      movable: true,
      lane: 1,
      color: "#ffb347",
      description: "Haftalık sprint planlama toplantısı.",
      dependencies: []
    },
    {
      id: 4,
      groupId: 2,
      title: "Mission-4",
      startMin: 6 * 60 + 30,
      endMin: 7 * 60 + 30,
      movable: true,
      lane: 0,
      color: "#4caf50",
      dependencies: []
    },
    {
      id: 5,
      groupId: 1,
      title: "Mission 5",
      startMin: 0 * 60,
      endMin: 2 * 60,
      movable: false,
      lane: 0,
      color: "#ff6fb1",
      dependencies: []
    },
    {
      id: 6,
      groupId: 1,
      title: "Mission 6",
      startMin: 10 * 60,
      endMin: 11 * 60,
      movable: true,
      lane: 0,
      color: "#ff6fb1",
      dependencies: [2]
    },
    {
      id: 7,
      groupId: 1,
      title: "Mission 7",
      startMin: 12 * 60,
      endMin: 14 * 60,
      movable: true,
      lane: 0,
      color: "#ff6fb1",
      dependencies: []
    },
    {
      id: 8,
      groupId: 1,
      title: "Mission 8",
      startMin: 15 * 60,
      endMin: 17 * 60,
      movable: true,
      lane: 0,
      color: "#ff6fb1",
      dependencies: []
    },
    {
      id: 9,
      groupId: 1,
      title: "Mission 9",
      startMin: 21 * 60,
      endMin: 23 * 60,
      movable: true,
      lane: 0,
      color: "#ff6fb1",
      dependencies: []
    },
    {
      id: 10,
      groupId: 1,
      title: "Mission 10",
      startMin: 2 * 60,
      endMin: 5 * 60,
      movable: true,
      lane: 1,
      color: "#ffb347",
      dependencies: []
    },
    {
      id: 11,
      groupId: 1,
      title: "Mission 11",
      startMin: 13 * 60 + 30,
      endMin: 15 * 60 + 30,
      movable: false,
      lane: 1,
      color: "#ffb347",
      dependencies: []
    },
    {
      id: 12,
      groupId: 1,
      title: "Mission 12",
      startMin: 18 * 60,
      endMin: 20 * 60,
      movable: true,
      lane: 1,
      color: "#ffb347",
      dependencies: []
    },
    {
      id: 13,
      groupId: 2,
      title: "Mission 13",
      startMin: 8 * 60,
      endMin: 9 * 60 + 30,
      movable: true,
      lane: 0,
      color: "#4caf50",
      dependencies: []
    },
    {
      id: 14,
      groupId: 2,
      title: "Mission 14",
      startMin: 11 * 60,
      endMin: 13 * 60,
      movable: true,
      lane: 0,
      color: "#4caf50",
      dependencies: [13]
    },
    {
      id: 15,
      groupId: 2,
      title: "Mission 15",
      startMin: 14 * 60,
      endMin: 16 * 60,
      movable: false,
      lane: 0,
      color: "#4caf50",
      dependencies: []
    },
    {
      id: 16,
      groupId: 2,
      title: "Mission 16",
      startMin: 19 * 60,
      endMin: 21 * 60,
      movable: true,
      lane: 0,
      color: "#4caf50",
      dependencies: []
    },
    {
      id: 17,
      groupId: 2,
      title: "Mission 17",
      startMin: 0 * 60 + 30,
      endMin: 2 * 60 + 30,
      movable: true,
      lane: 1,
      color: "#2e7d32",
      dependencies: []
    },
    {
      id: 18,
      groupId: 2,
      title: "Mission 18",
      startMin: 16 * 60 + 30,
      endMin: 18 * 60,
      movable: true,
      lane: 1,
      color: "#2e7d32",
      dependencies: []
    },
    {
      id: 19,
      groupId: 3,
      title: "Mission 19",
      startMin: 3 * 60,
      endMin: 6 * 60,
      movable: true,
      lane: 0,
      color: "#7b61ff",
      dependencies: []
    },
    {
      id: 20,
      groupId: 3,
      title: "Mission 20",
      startMin: 9 * 60,
      endMin: 11 * 60,
      movable: true,
      lane: 0,
      color: "#7b61ff",
      dependencies: []
    },
    {
      id: 21,
      groupId: 3,
      title: "Mission 21",
      startMin: 20 * 60,
      endMin: 22 * 60,
      movable: true,
      lane: 0,
      color: "#7b61ff",
      dependencies: []
    },
    {
      id: 22,
      groupId: 4,
      title: "Mission 22",
      startMin: 1 * 60,
      endMin: 3 * 60,
      movable: true,
      lane: 0,
      color: "#00bcd4",
      dependencies: []
    },
    {
      id: 23,
      groupId: 4,
      title: "Mission 23",
      startMin: 6 * 60,
      endMin: 8 * 60,
      movable: true,
      lane: 0,
      color: "#00bcd4",
      dependencies: []
    },
    {
      id: 24,
      groupId: 4,
      title: "Mission 24",
      startMin: 12 * 60 + 30,
      endMin: 14 * 60 + 30,
      movable: true,
      lane: 0,
      color: "#00bcd4",
      dependencies: []
    },
    {
      id: 25,
      groupId: 5,
      title: "Mission 25",
      startMin: 4 * 60,
      endMin: 6 * 60,
      movable: true,
      lane: 0,
      color: "#2196f3",
      dependencies: []
    },
    {
      id: 26,
      groupId: 5,
      title: "Mission 26",
      startMin: 15 * 60,
      endMin: 18 * 60,
      movable: true,
      lane: 0,
      color: "#2196f3",
      dependencies: []
    },
    {
      id: 27,
      groupId: 6,
      title: "Mission 27",
      startMin: 7 * 60 + 30,
      endMin: 9 * 60,
      movable: true,
      lane: 0,
      color: "#ff9800",
      dependencies: []
    },
    {
      id: 28,
      groupId: 6,
      title: "Mission 28",
      startMin: 17 * 60,
      endMin: 18 * 60 + 30,
      movable: true,
      lane: 0,
      color: "#ff9800",
      dependencies: []
    },

    {
      id: 29,
      groupId: 1,
      title: "Firmware Upload",
      startMin: 2 * 60 + 30,
      endMin: 4 * 60 + 30,
      movable: true,
      lane: 0,
      color: "#b8b8b8",
      description: "Firmware v2.4 uploaded to staging environment.",
      dependencies: []
    },

    {
      id: 30,
      groupId: 1,
      title: "Telemetry Check",
      startMin: 17 * 60 + 30,
      endMin: 19 * 60,
      movable: true,
      lane: 0,
      color: "#b8b8b8",
      description: "All 12 telemetry channels verified nominal.",
      dependencies: []
    },

    {
      id: 31,
      groupId: 2,
      title: "Code Review Sprint-4",
      startMin: 1 * 60,
      endMin: 3 * 60 + 30,
      movable: true,
      lane: 0,
      color: "#b8b8b8",
      description: "14 PRs reviewed and merged into main.",
      dependencies: []
    },

    {
      id: 32,
      groupId: 3,
      title: "DB Migration v3.2",
      startMin: 0 * 60 + 30,
      endMin: 2 * 60 + 30,
      movable: true,
      lane: 0,
      color: "#b8b8b8",
      description: "Schema v3.2 migrated to production successfully.",
      dependencies: []
    },

    {
      id: 33,
      groupId: 4,
      title: "Regression Tests",
      startMin: 3 * 60 + 30,
      endMin: 5 * 60 + 30,
      movable: true,
      lane: 0,
      color: "#b8b8b8",
      description: "847/847 tests passed, 0 regressions detected.",
      dependencies: []
    },

    {
      id: 34,
      groupId: 5,
      title: "Security Audit",
      startMin: 1 * 60,
      endMin: 3 * 60,
      movable: true,
      lane: 0,
      color: "#b8b8b8",
      description: "No critical vulnerabilities found. 2 low-severity items logged.",
      dependencies: []
    },
 
    {
      id: 35,
      groupId: 6,
      title: "Backup Verification",
      startMin: 1 * 60,
      endMin: 3 * 60 + 30,
      movable: true,
      lane: 0,
      color: "#b8b8b8",
      description: "Full backup integrity verified — 2.4 TB checksummed.",
      dependencies: []
    },

    {
      id: 36,
      groupId: 1,
      title: "Event-1",
      startMin: 5 * 60 + 30,
      endMin: 6 * 60 + 30,
      movable: false,
      lane: 1,
      color: "#3498db",
      kind: "event",
      eventType: "meeting",
      participants: "All Hands",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
      dependencies: []
    },
   
    {
      id: 37,
      groupId: 2,
      title: "Event-2",
      startMin: 6 * 60,
      endMin: 7 * 60 + 30,
      movable: false,
      lane: 1,
      color: "#2980b9",
      kind: "event",
      eventType: "meeting",
      participants: "Dev Team, PO, SM",
      description: "",
      dependencies: []
    },

    {
      id: 38,
      groupId: 2,
      title: "Event-3",
      startMin: 10 * 60,
      endMin: 11 * 60,
      movable: false,
      lane: 1,
      color: "#e67e22",
      kind: "event",
      eventType: "deadline",
      participants: "Design → Dev",
      description: "Sed ut perspiciatis unde omnis iste natus error sit voluptatem.",
      dependencies: []
    },
  
    {
      id: 39,
      groupId: 3,
      title: "Event-4",
      startMin: 7 * 60,
      endMin: 8 * 60 + 30,
      movable: false,
      lane: 0,
      color: "#e67e22",
      kind: "event",
      eventType: "meeting",
      participants: "Architects, Tech Leads",
      description: "",
      dependencies: []
    },

    {
      id: 40,
      groupId: 4,
      title: "Event-5",
      startMin: 9 * 60,
      endMin: 10 * 60 + 30,
      movable: false,
      lane: 0,
      color: "#f39c12",
      kind: "event",
      eventType: "milestone",
      participants: "Client, PM, Dev Lead",
      description: "Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis.",
      dependencies: []
    },

    {
      id: 41,
      groupId: 5,
      title: "Event-6",
      startMin: 10 * 60,
      endMin: 11 * 60,
      movable: false,
      lane: 0,
      color: "#1abc9c",
      kind: "event",
      eventType: "meeting",
      participants: "Cross-team Leads",
      description: "",
      dependencies: []
    },

    {
      id: 42,
      groupId: 6,
      title: "Event-7",
      startMin: 12 * 60,
      endMin: 13 * 60 + 30,
      movable: false,
      lane: 0,
      color: "#95a5a6",
      kind: "event",
      eventType: "maintenance",
      participants: "Ops Team",
      description: "Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit.",
      dependencies: []
    },

    {
      id: 43,
      groupId: 3,
      title: "Event-8",
      startMin: 14 * 60,
      endMin: 15 * 60,
      movable: false,
      lane: 0,
      color: "#8e44ad",
      kind: "event",
      eventType: "meeting",
      participants: "Dev Team",
      description: "",
      dependencies: []
    },
  ],
};

export const defaultCompletedIds = [29, 30, 31, 32, 33, 34, 35];

export const seedMilestones = [
  {
    id: "ms-seed-1",
    title: "CDR",
    datetime: "2026-03-18T10:00:00.000Z",
    color: "#e67e22",
  },
  {
    id: "ms-seed-2",
    title: "PDR",
    datetime: "2026-03-18T16:00:00.000Z",
    color: "#9b59b6",
  },
  {
    id: "ms-seed-3",
    title: "Launch Window",
    datetime: "2026-03-18T22:00:00.000Z",
    color: "#e74c3c",
  },
  {
    id: "ms-seed-4",
    title: "Sprint Deadline",
    datetime: "2026-03-18T13:00:00.000Z",
    color: "#27ae60",
  },
];

export const seedInstantEvents = [
  {
    id: "ie-seed-1",
    title: "AN",
    datetime: "2026-03-18T07:07:00.000Z",
    groupId: 1,
    symbol: "▲",
    color: "#333333",
  },
  {
    id: "ie-seed-2",
    title: "AP",
    datetime: "2026-03-18T13:47:00.000Z",
    groupId: 1,
    symbol: "●",
    color: "#333333",
  },
  {
    id: "ie-seed-3",
    title: "DN",
    datetime: "2026-03-18T18:22:00.000Z",
    groupId: 1,
    symbol: "▼",
    color: "#333333",
  },
  {
    id: "ie-seed-4",
    title: "Eclipse Entry",
    datetime: "2026-03-18T09:30:00.000Z",
    groupId: 2,
    symbol: "◆",
    color: "#e74c3c",
  },
  {
    id: "ie-seed-5",
    title: "Eclipse Exit",
    datetime: "2026-03-18T10:15:00.000Z",
    groupId: 2,
    symbol: "◇",
    color: "#27ae60",
  },
  {
    id: "ie-seed-6",
    title: "GS Pass",
    datetime: "2026-03-18T14:30:00.000Z",
    groupId: 3,
    symbol: "★",
    color: "#f39c12",
  },
];

export const seedLaneCounts = {
  "1": 1, "2": 1, "3": 1, "4": 1, "5": 1, "6": 1, "7": 1
};
export const seedLaneHeight = 20;

export default itemsByDate;