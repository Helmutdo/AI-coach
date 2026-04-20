export const SPORT_COLORS = {
  swim: {
    bg: '#E6F1FB',
    text: '#0C447C',
    dot: '#378ADD',
    dark_bg: '#0C447C',
    dark_text: '#B5D4F4',
  },
  bike: {
    bg: '#FAEEDA',
    text: '#633806',
    dot: '#EF9F27',
    dark_bg: '#633806',
    dark_text: '#FAC775',
  },
  run: {
    bg: '#E1F5EE',
    text: '#085041',
    dot: '#1D9E75',
    dark_bg: '#085041',
    dark_text: '#9FE1CB',
  },
  brick: {
    bg: '#EEEDFE',
    text: '#3C3489',
    dot: '#7F77DD',
    dark_bg: '#3C3489',
    dark_text: '#CECBF6',
  },
} as const;

export function getSportColor(sportType: string | null | undefined) {
  const s = (sportType ?? '').toLowerCase();
  if (s.includes('swim') || s.includes('open_water')) return SPORT_COLORS.swim;
  if (s.includes('ride') || s.includes('cycling') || s.includes('bike') || s.includes('virtual')) return SPORT_COLORS.bike;
  if (s.includes('run') || s.includes('trail')) return SPORT_COLORS.run;
  if (s.includes('brick')) return SPORT_COLORS.brick;
  return SPORT_COLORS.run;
}
