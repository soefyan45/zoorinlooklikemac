// Design tokens from the Pego project "zoorinlooklikemac" (smo9dehb).
// Keep names identical to the Pego variables so the design and code stay in sync.

export const Color = {
    notch: '#000000',
    notchPanel: '#06080FC7',
    notchGlass: '#0B0F1A94',
    notchGlassEdge: '#FFFFFF2E',
    notchIdleEdge: '#FFFFFF1F',
    notchControl: '#FFFFFF24',
    notchTile: '#FFFFFF12',
    notchTileEdge: '#FFFFFF0F',
    notchLabel: '#FFFFFFB8',
    menuText: '#FFFFFF',
    menuTextMuted: '#FFFFFFD9',
    accent: '#F05A24',
    onAccent: '#0F0E12',
    danger: '#B81D13',
    ai: '#4FD1C5',
    aiSoft: '#4FD1C51F',
    aiEdge: '#4FD1C573',
    onAi: '#06201D',
    camera: '#101018',
    cameraEdge: '#1F2030',
    shadow: '#00000052',
};

export const Radius = {
    sm: 4,
    row: 18,
    rowIcon: 8,
    tile: 26,
    pill: 999,
};

export const Space = {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 24,
};

// Notch geometry: ears are the concave corners joining the notch to the screen edge
export const Shape = {
    compactEar: 6,
    compactBottomRadius: 11,
    expandedEar: 10,
    expandedBottomRadius: 28,
    cameraSize: 6,
    cameraY: 13,
};

// Size of each state in logical pixels, from the "Notch · semua tampilan" frame (4wqm80lv)
export const StateSize = {
    idle: [120, 4],
    hover: [160, 6],
    // Pointer over the line: the notch drops down and already shows date, time, network and
    // battery (the design's empty 212 px notch grew to the status width on request)
    peek: [300, 32],
    status: [300, 32],
    activity: [300, 32],
    notification: [420, 104],
    panel: [680, 228],
    notificationList: [560, 354],
    aiNotification: [460, 192],
    wifi: [440, 282],
    power: [340, 274],
    // Not in the Pego frames: app search opened from "Cari" in the full panel
    search: [560, 120],
    confirm: [400, 186],
};

// Click target around the idle line, larger than the line itself
export const IdleHitArea = [200, 12];

export const Timing = {
    statusAutoCloseMs: 5000,
    notificationMs: 5000,
    hoverGrowMs: 450,
    revealMs: 820,
    notificationSlideMs: 700,
};
