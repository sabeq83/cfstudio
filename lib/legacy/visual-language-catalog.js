/**
 * Visual Language Catalog
 * Deterministic central catalog for visual styles, narrative functions, family/medium taxonomy, and prompt templates.
 */

export const DEFAULT_VISUAL_STYLE = 'cinematic_realistic';

export const VISUAL_STYLE_KEYS = [
  'cinematic_realistic',
  'commercial_product_cinematic',
  'culinary_cinematic',
  'stylized_3d_character',
  'cozy_claymation',
  'editorial_graphic_novel',
  'isometric_society',
  'symbolic_surrealism',
  'paper_cutout_documentary',
  'shadow_silhouette',
  'clay_political_theater'
];

export const PRIMARY_STYLE_KEYS = [
  'cinematic_realistic',
  'commercial_product_cinematic',
  'culinary_cinematic',
  'stylized_3d_character',
  'cozy_claymation',
  'editorial_graphic_novel'
];

export const SUPPORTING_ONLY_STYLE_KEYS = [
  'isometric_society',
  'symbolic_surrealism',
  'paper_cutout_documentary',
  'shadow_silhouette',
  'clay_political_theater'
];

export const NARRATIVE_FUNCTIONS = [
  'hook',
  'context',
  'mechanism',
  'consequence',
  'evidence_reveal',
  'conclusion'
];

export const VISUAL_LANGUAGE_CATALOG = {
  cinematic_realistic: {
    key: 'cinematic_realistic',
    label: 'Cinematic Realistic',
    family: 'cinematic',
    medium: 'photorealistic',
    role: 'primary',
    description: 'Realistic cinematic film aesthetic with natural lighting, subtle film grain, and high aesthetic quality for general/lifestyle storytelling.',
    prompt: 'premium cinematic realistic photography, natural film grain, authentic lighting roll-off, clean optics, dynamic depth of field, high aesthetic value, professional visual storytelling',
    negative_prompts: ['oversaturated cartoon', 'glossy 3D CGI', 'flat 2D graphic', 'distorted artifacts', 'uncalibrated exposure']
  },
  commercial_product_cinematic: {
    key: 'commercial_product_cinematic',
    label: 'Commercial Product Cinematic',
    family: 'commercial',
    medium: 'photorealistic',
    role: 'primary',
    description: 'High-end commercial product and lifestyle workspace photography with crisp textures, luxury brand color grading, and hands-only focus.',
    prompt: 'high-end commercial product cinematography, crisp tactile material details, premium studio lighting, clean minimal surfaces, luxury brand color grading, professional hands-only interaction, immaculate visual clarity',
    negative_prompts: ['messy cluttered background', 'cartoon 3D', 'harsh uncalibrated shadows', 'amateur snapshot', 'cheap plastic look']
  },
  culinary_cinematic: {
    key: 'culinary_cinematic',
    label: 'Culinary Cinematic',
    family: 'culinary',
    medium: 'photorealistic',
    role: 'primary',
    description: 'Artisanal kitchen, culinary cooking action, fresh organic ingredients, and appetizing warm lighting.',
    prompt: 'mouth-watering culinary cinematography, rich food textures, natural soft kitchen daylight, artisanal cookware, fresh organic ingredients, tactile cooking action, appetizing warm aesthetic, crisp micro-details',
    negative_prompts: ['political graphic novel', 'gloomy dark noir', 'cartoon illustration', 'stale untextured food', 'artificial plastic props']
  },
  stylized_3d_character: {
    key: 'stylized_3d_character',
    label: 'Stylized 3D Character',
    family: 'character_3d',
    medium: 'stylized_3d',
    role: 'primary',
    description: 'Faceless stylized 3D character with smooth render geometry, charming proportions, and clean animation studio lighting.',
    prompt: 'stylized 3D cartoon render, smooth matte surfaces, charming geometric proportions, blank faceless character design, high-end 3D animation studio aesthetic, soft studio three-point lighting, clean pastel or rich color harmony',
    negative_prompts: ['photorealistic human face', 'uncanny live action', 'flat 2D vector clipart', 'harsh gritty ink', 'grainy paper textures']
  },
  cozy_claymation: {
    key: 'cozy_claymation',
    label: 'Cozy Claymation',
    family: 'character_3d',
    medium: 'claymation',
    role: 'primary',
    description: 'Tactile stop-motion clay aesthetic for warm characters, whimsical mascots, and cozy universes with visible craft fingerprints.',
    prompt: 'tactile handcrafted stop-motion clay animation aesthetic, soft matte plasticine material, subtle organic craft fingerprints, miniature studio lighting setup, warm cozy whimsical charm, soft clay volume and physical depth',
    negative_prompts: ['glossy digital CGI', 'live action human footage', 'sharp polygonal edges', 'dark violent mood', 'flat vector graphic']
  },
  editorial_graphic_novel: {
    key: 'editorial_graphic_novel',
    label: 'Editorial Graphic Novel',
    family: 'editorial',
    medium: 'illustration',
    role: 'both',
    description: 'Modern political graphic novel with strong silhouettes, restrained color accents, and high-impact visual journalism framing.',
    prompt: 'premium editorial political illustration, modern graphic novel aesthetic, sharp graphic silhouettes, dynamic panel-like framing, matte vector ink finish, high contrast editorial composition, intelligent visual journalism storytelling',
    negative_prompts: ['photorealistic stock footage', 'news TV broadcast composition', 'glossy 3D CGI', 'generic corporate vector clipart']
  },
  isometric_society: {
    key: 'isometric_society',
    label: 'Isometric Society',
    family: 'editorial',
    medium: 'illustration',
    role: 'supporting',
    description: 'Miniature systemic overview explaining public infrastructure, institutions, economic loops, and societal flows.',
    prompt: 'isometric miniature society, elevated angled systemic perspective, interconnected urban infrastructure, transparent institutional cross-sections, readable supply and policy flow, clean architectural precision, stylized modular miniature citizens',
    negative_prompts: ['decorative isometric scene without readable system flow', 'flat 2D infographic', 'unclear camera angle']
  },
  symbolic_surrealism: {
    key: 'symbolic_surrealism',
    label: 'Symbolic Surrealism',
    family: 'editorial',
    medium: 'illustration',
    role: 'supporting',
    description: 'Metaphorical concept translation using physical scale shifts, surreal balance, and symbolic physical objects.',
    prompt: 'symbolic conceptual surrealism, editorial thought-experiment illustration, dramatic scale disparity, physical metaphor objects, clean negative space, thought-provoking philosophical composition, dreamlike yet precise intellectual visual metaphor',
    negative_prompts: ['literal realistic scene', 'chaotic abstract noise without clear focal idea', 'fantasy magical glow']
  },
  paper_cutout_documentary: {
    key: 'paper_cutout_documentary',
    label: 'Paper Cutout Documentary',
    family: 'editorial',
    medium: 'paper_cutout',
    role: 'supporting',
    description: 'Layered tactile collages for legal documents, budgets, timeline reveals, and investigative newsroom facts.',
    prompt: 'tactile paper cutout documentary collage, multi-layered textured paper crafts, archival document fragments, subtle physical drop shadows between layers, investigative newsroom dossier feel, stop-motion papercraft aesthetic',
    negative_prompts: ['smooth digital gradients', 'untextured flat graphics', 'glossy plastic finish']
  },
  shadow_silhouette: {
    key: 'shadow_silhouette',
    label: 'Shadow & Silhouette',
    family: 'editorial',
    medium: 'illustration',
    role: 'supporting',
    description: 'High-contrast light and shadow drama representing unseen power, covert influence, and structural barriers.',
    prompt: 'dramatic high-contrast shadow and silhouette, stark chiaroscuro lighting, deep theatrical cast shadows revealing structural forces, back-lit faceless figures, bold minimalist noir atmosphere',
    negative_prompts: ['soft flat low-contrast lighting', 'visible facial expressions', 'colorful bright palette']
  },
  clay_political_theater: {
    key: 'clay_political_theater',
    label: 'Clay Political Theater',
    family: 'editorial',
    medium: 'claymation',
    role: 'supporting',
    description: 'Tactile stop-motion clay aesthetic for political satire, bureaucratic parody, and behavioral caricatures.',
    prompt: 'tactile handcrafted stop-motion clay animation aesthetic, matte plasticine material texture, miniature studio lighting setup, satirical political theater staging, fingerprint craft details, stylized faceless clay characters',
    negative_prompts: ['smooth digital CGI render', 'photorealistic live action', 'hyper-glossy porcelain']
  }
};

export class InvalidVisualStyleError extends Error {
  constructor(key, field = 'visual_language.primary_style') {
    super(`Invalid visual style: "${key}". Allowed styles: ${VISUAL_STYLE_KEYS.join(', ')}`);
    this.name = 'InvalidVisualStyleError';
    this.code = 'INVALID_VISUAL_STYLE';
    this.field = field;
    this.invalidKey = key;
    this.allowedKeys = [...VISUAL_STYLE_KEYS];
  }
}

export function createInvalidVisualStyleError(key, field) {
  return new InvalidVisualStyleError(key, field);
}

export function getVisualStyleDefinition(key = DEFAULT_VISUAL_STYLE) {
  if (!key) {
    return VISUAL_LANGUAGE_CATALOG[DEFAULT_VISUAL_STYLE];
  }
  const definition = VISUAL_LANGUAGE_CATALOG[key];
  if (!definition) {
    throw new InvalidVisualStyleError(key);
  }
  return definition;
}

export function isValidVisualStyle(key) {
  return typeof key === 'string' && VISUAL_STYLE_KEYS.includes(key);
}

export function isValidNarrativeFunction(fn) {
  return typeof fn === 'string' && NARRATIVE_FUNCTIONS.includes(fn);
}

export function getDefaultNarrativeRouting(primaryStyle = DEFAULT_VISUAL_STYLE) {
  const fallback = isValidVisualStyle(primaryStyle) ? primaryStyle : DEFAULT_VISUAL_STYLE;
  return {
    hook: fallback,
    context: fallback,
    mechanism: fallback,
    consequence: fallback,
    evidence_reveal: fallback,
    conclusion: fallback
  };
}

export function groupVisualStylesByFamily(catalog = VISUAL_LANGUAGE_CATALOG) {
  const groups = {};
  for (const [key, item] of Object.entries(catalog)) {
    const fam = item.family || 'general';
    if (!groups[fam]) groups[fam] = [];
    groups[fam].push(item);
  }
  return groups;
}

export function listVisualStylesForAi() {
  return Object.values(VISUAL_LANGUAGE_CATALOG).map(item => ({
    key: item.key,
    label: item.label,
    family: item.family,
    medium: item.medium,
    role: item.role,
    description: item.description
  }));
}
