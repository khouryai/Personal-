// Quick-preset templates. Each returns a partial sticker style that is merged
// onto the default sticker when applied.
export const TEMPLATES = {
  // Same look and settings as the Sale sticker, in deep purple with white text.
  pins: {
    label: 'Pins',
    text: '$',
    shape: 'circle',
    bgColor: '#6D28D9',
    textColor: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 40,
    pad: 8,
    rotation: 0,
    textAngle: 0,
    scale: 1,
    opacity: 1,
    shadow: 'rgba(0,0,0,0.25) 0 2 6',
  },
  clearance: {
    label: 'Clearance tag',
    text: '70% OFF',
    shape: 'tag',
    bgColor: '#E11D48',
    textColor: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 32,
    shadow: 'rgba(0,0,0,0.35) 0 3 8',
  },
  luxury: {
    label: 'Luxury label',
    text: '$199',
    shape: 'rounded_rect',
    bgColor: '#111111',
    textColor: '#D4AF37',
    fontWeight: 'bold',
    fontSize: 30,
    shadow: 'rgba(0,0,0,0.4) 0 2 10',
  },
  sale: {
    label: 'Sale sticker',
    text: '$',
    shape: 'circle',
    bgColor: '#FFFFFF',
    textColor: '#000000',
    fontWeight: 'bold',
    fontSize: 40,
    pad: 8,
    rotation: 0,
    textAngle: 0,
    scale: 1,
    opacity: 1,
    shadow: 'rgba(0,0,0,0.25) 0 2 6',
  },
}

export const TEMPLATE_LIST = Object.entries(TEMPLATES).map(([key, t]) => ({
  key,
  ...t,
}))
