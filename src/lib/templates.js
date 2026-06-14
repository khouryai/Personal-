// Quick-preset templates. Each returns a partial sticker style that is merged
// onto the default sticker when applied.
export const TEMPLATES = {
  amazon: {
    label: 'Amazon style',
    text: '$19.99',
    shape: 'rounded_rect',
    bgColor: '#FF9900',
    textColor: '#111111',
    fontWeight: 'bold',
    fontSize: 34,
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
    text: 'SALE',
    shape: 'circle',
    bgColor: '#FFD700',
    textColor: '#C00000',
    fontWeight: 'bold',
    fontSize: 30,
    shadow: 'rgba(0,0,0,0.25) 0 2 6',
  },
}

export const TEMPLATE_LIST = Object.entries(TEMPLATES).map(([key, t]) => ({
  key,
  ...t,
}))
