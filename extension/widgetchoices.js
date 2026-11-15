// Styles of the desktop widgets: [value, title, line below, icon]. Shared by the widgets' right
// click menu and Preferences > Widget; no GNOME Shell imports here.

export const WEATHER_CHOICES = [
    ['full', 'Full', 'Hourly, 5 days, warnings', 'view-list-symbolic'],
    ['sun-arc', 'Sun arc', 'Sky follows the hour, sun position', 'weather-clear-symbolic'],
    ['big', 'Big temperature', 'Big number, wind, UV, hourly', 'temperature-symbolic'],
    ['strip', 'Date strip', 'Weather along the days', 'x-office-calendar-symbolic'],
    ['hidden', 'Hide', 'No weather widget', 'view-conceal-symbolic'],
];

export const CALENDAR_CHOICES = [
    ['full', 'Full', 'Whole month plus agenda', 'x-office-calendar-symbolic'],
    ['agenda', 'Agenda blocks', 'Big date, events as blocks', 'view-list-symbolic'],
    ['week-arc', 'Week arc', 'One week on a curve', 'x-office-calendar-symbolic'],
    ['glass-month', 'Glass month', 'Light glass, dates only', 'x-office-calendar-symbolic'],
    ['meetings', "Today's meetings", 'Work week and action buttons', 'alarm-symbolic'],
    ['mono', 'Black and white', 'The next event', 'emblem-ok-symbolic'],
    ['tear-off', 'Tear-off calendar', 'Wall calendar look', 'x-office-calendar-symbolic'],
    ['hidden', 'Hide', 'No calendar widget', 'view-conceal-symbolic'],
];
