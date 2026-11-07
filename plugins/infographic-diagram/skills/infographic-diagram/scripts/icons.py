"""Generic line icons on a 24x24 grid (stroke = currentColor).
Original, brand-free shapes. Add new ones here; keep them simple strokes."""

ICONS = {
    "monitor":   '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    "globe":     '<circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20"/>',
    "web":       '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><circle cx="12" cy="10" r="4"/><path d="M8 10h8"/>',
    "mobile":    '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    "code":      '<rect x="2" y="3" width="20" height="18" rx="3"/><path d="M9 9l-3 3 3 3M15 9l3 3-3 3M13 8l-2 8"/>',
    "bolt":      '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    "share":     '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/>',
    "network":   '<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="3.5" r="2"/><circle cx="20" cy="9" r="2"/><circle cx="17" cy="19.5" r="2"/><circle cx="7" cy="19.5" r="2"/><circle cx="4" cy="9" r="2"/><path d="M12 5.5v4M18.2 9.8l-3.9 1.4M15.8 17.8l-2.4-3.6M8.2 17.8l2.4-3.6M5.8 9.8l3.9 1.4"/>',
    "clipboard": '<rect x="5" y="4" width="14" height="18" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 13l2 2 4-4"/>',
    "gear":      '<path d="M21.36 10.39 L21.36 13.61 L18.83 13.55 L17.92 15.73 L19.76 17.48 L17.48 19.76 L15.73 17.92 L13.55 18.83 L13.61 21.36 L10.39 21.36 L10.45 18.83 L8.27 17.92 L6.52 19.76 L4.24 17.48 L6.08 15.73 L5.17 13.55 L2.64 13.61 L2.64 10.39 L5.17 10.45 L6.08 8.27 L4.24 6.52 L6.52 4.24 L8.27 6.08 L10.45 5.17 L10.39 2.64 L13.61 2.64 L13.55 5.17 L15.73 6.08 L17.48 4.24 L19.76 6.52 L17.92 8.27 L18.83 10.45Z"/><circle cx="12" cy="12" r="3"/>',
    "shield":    '<path d="M12 2l8 3v6c0 5.5-3.5 9.5-8 11-4.5-1.5-8-5.5-8-11V5z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    "wrench":    '<circle cx="15.5" cy="8.5" r="4.5"/><path d="M12.3 11.7L4 20"/>',
    "database":  '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    "layers":    '<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 12l10 5 10-5M2 17l10 5 10-5"/>',
    "vector":    '<circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>',
    "rocket":    '<path d="M12 2c3 2 5 6 5 10l-2 4H9l-2-4c0-4 2-8 5-10z"/><circle cx="12" cy="9" r="1.8"/><path d="M9 16l-2.5 4 3.5-1M15 16l2.5 4-3.5-1"/>',
    "box":       '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
    "wheel":     '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v6.5M12 14.5V21M3 12h6.5M14.5 12H21M5.6 5.6l4.6 4.6M13.8 13.8l4.6 4.6M18.4 5.6l-4.6 4.6M10.2 13.8l-4.6 4.6"/>',
    "cpu":       '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    "cloud":     '<path d="M7 19h10a4.5 4.5 0 0 0 .6-9 6 6 0 0 0-11.4 1.6A3.7 3.7 0 0 0 7 19z"/>',
    "user":      '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    "users":     '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.6 3-6 7-6s7 2.4 7 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.4.6 4 2.8 4 6"/>',
    "lock":      '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    "key":       '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L20 3M17 6l3 3"/>',
    "search":    '<circle cx="11" cy="11" r="7"/><path d="M16 16l5 5"/>',
    "file":      '<path d="M6 2h8l5 5v15H6z"/><path d="M14 2v5h5M9 13h6M9 17h6"/>',
    "chart":     '<path d="M3 3v18h18"/><path d="M7 16v-4M11 16V8M15 16v-6M19 16V5"/>',
    "sparkle":   '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/><path d="M19 2v4M17 4h4"/>',
    "mail":      '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    "message":   '<path d="M4 4h16v12H9l-5 4z"/>',
    "check":     '<circle cx="12" cy="12" r="10"/><path d="M7.5 12l3 3 6-6"/>',
    "queue":     '<rect x="2" y="7" width="5" height="10" rx="1"/><rect x="9.5" y="7" width="5" height="10" rx="1"/><rect x="17" y="7" width="5" height="10" rx="1"/>',
    "stream":    '<path d="M3 7h13M3 12h16M3 17h10"/><path d="M14 4l3 3-3 3M17 9l3 3-3 3"/>',
    "server":    '<rect x="3" y="3" width="18" height="7" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/><path d="M7 6.5h.01M7 17.5h.01"/>',
    "terminal":  '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M6 9l3 3-3 3M12 15h6"/>',
    "bell":      '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    "clock":     '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    "card":      '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    "bank":      '<path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>',
    "watch":     '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l1-4h4l1 4M9 18l1 4h4l1-4M12 9.5V12l1.5 1.5"/>',
    "droplet":   '<path d="M12 2.5C8 8 6 11 6 14a6 6 0 0 0 12 0c0-3-2-6-6-11.5z"/>',
    "git":       '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 7.5v9M18 11.5c0 4-6 3-11 6"/>',
    "plug":      '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>',
    "refresh":   '<path d="M20 11a8 8 0 0 0-14.7-4.3L3 9M4 13a8 8 0 0 0 14.7 4.3L21 15"/><path d="M3 4v5h5M21 20v-5h-5"/>',
    "brain":     '<path d="M12 4.5a3 3 0 0 0-5.6-1.2A3.2 3.2 0 0 0 3.5 7a3.3 3.3 0 0 0-.6 5.6 3.3 3.3 0 0 0 2 5.2A3.2 3.2 0 0 0 12 19.5z"/><path d="M12 4.5a3 3 0 0 1 5.6-1.2A3.2 3.2 0 0 1 20.5 7a3.3 3.3 0 0 1 .6 5.6 3.3 3.3 0 0 1-2 5.2A3.2 3.2 0 0 1 12 19.5z"/><path d="M12 4.5v15M8 9h-1.5M16 9h1.5M8.5 14H7M15.5 14H17"/>',
    "book":      '<path d="M2 5c3-1.5 7-1.5 10 1 3-2.5 7-2.5 10-1v14c-3-1.5-7-1.5-10 1-3-2.5-7-2.5-10-1z"/><path d="M12 6v14"/>',
    "folder":    '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    "tag":       '<path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    "store":     '<path d="M3 9l2-5h14l2 5M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM5 13v8h14v-8M10 21v-5h4v5"/>',
    "package":   '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10M7.5 4.5l9 5"/>',
}


def icon(name, x, y, size, color, stroke=2.0):
    body = ICONS.get(name, ICONS["box"])
    s = size / 24.0
    return (f'<g transform="translate({x:.1f},{y:.1f}) scale({s:.4f})" fill="none" '
            f'stroke="{color}" stroke-width="{stroke}" stroke-linecap="round" '
            f'stroke-linejoin="round">{body}</g>')
