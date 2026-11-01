/**
 * Formatter deterministik untuk naskah resep media sosial
 * Mendukung multi-bahasa (Bahasa Indonesia & English)
 */

export function formatRecipeTextMarkdown(recipe = {}, options = {}) {
  const lang = (options.lang || options.targetLanguage || 'id').toLowerCase();
  const isEn = lang.startsWith('en');

  const defaultTitle = isEn ? 'Delicious Recipe' : 'Resep Kuliner';
  const defaultServings = isEn ? '1-2 Servings' : '1-2 Porsi';
  const title = (recipe.title || defaultTitle).trim();
  const servings = recipe.servings || recipe.estimated_servings || defaultServings;
  const prep = Number.isInteger(Number(recipe.prep_minutes)) ? Number(recipe.prep_minutes) : 2;
  const cook = Number.isInteger(Number(recipe.cook_minutes)) ? Number(recipe.cook_minutes) : 3;
  const totalTime = prep + cook;

  const headerMeta = isEn
    ? `Servings: ${servings} | Total Time: ${totalTime} Minutes`
    : `Porsi: ${servings} | Estimasi Waktu: ${totalTime} Menit`;
  const ingredientsHeader = isEn ? `## Ingredients:` : `## Bahan-Bahan:`;

  let md = `# ${title}\n\n${headerMeta}\n\n${ingredientsHeader}\n`;

  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  if (ingredients.length === 0) {
    md += isEn ? `- Ingredients to taste\n` : `- Bahan-bahan sesuai selera\n`;
  } else {
    for (const ing of ingredients) {
      const amount = ing.amount ? `${ing.amount} ` : '';
      const unit = ing.unit ? `${ing.unit} ` : '';
      const name = ing.name || (isEn ? 'Ingredient' : 'Bahan');
      const prodTag = ing.product_id ? (isEn ? ' (Featured Product)' : ' (Produk Utama)') : '';
      md += `- ${amount}${unit}${name}${prodTag}\n`;
    }
  }

  md += isEn ? `\n## Instructions:\n` : `\n## Cara Membuat:\n`;
  const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
  if (steps.length === 0) {
    md += isEn ? `1. Mix all ingredients until well combined.\n` : `1. Campurkan semua bahan hingga merata.\n`;
  } else {
    steps.forEach((step, idx) => {
      const num = step.index || (idx + 1);
      const instruction = step.instruction || (isEn ? 'Follow cooking instructions.' : 'Lakukan langkah memasak.');
      md += `${num}. ${instruction}\n`;
    });
  }

  const tips = Array.isArray(recipe.tips) ? recipe.tips : [];
  if (tips.length > 0) {
    md += isEn ? `\n## Chef Tips:\n` : `\n## Tips Chef:\n`;
    for (const tip of tips) {
      md += `- ${tip}\n`;
    }
  }

  return md;
}

export function formatRecipeTextPlain(recipe = {}, options = {}) {
  const lang = (options.lang || options.targetLanguage || 'id').toLowerCase();
  const isEn = lang.startsWith('en');

  const defaultTitle = isEn ? 'DELICIOUS RECIPE' : 'RESEP KULINER';
  const defaultServings = isEn ? '1 Serving' : '1 Porsi';
  const title = (recipe.title || defaultTitle).trim().toUpperCase();
  const servings = recipe.servings || recipe.estimated_servings || defaultServings;
  const prep = Number.isInteger(Number(recipe.prep_minutes)) ? Number(recipe.prep_minutes) : 2;
  const cook = Number.isInteger(Number(recipe.cook_minutes)) ? Number(recipe.cook_minutes) : 3;
  const totalTime = prep + cook;

  const headerMeta = isEn
    ? `Servings: ${servings} | Total Time: ${totalTime} Mins`
    : `Porsi: ${servings} | Waktu: ${totalTime} Menit`;
  const ingredientsHeader = isEn ? `INGREDIENTS:` : `BAHAN-BAHAN:`;

  let text = `${title}\n${headerMeta}\n\n${ingredientsHeader}\n`;

  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  if (ingredients.length === 0) {
    text += isEn ? `• Ingredients to taste\n` : `• Bahan-bahan secukupnya\n`;
  } else {
    for (const ing of ingredients) {
      const amount = ing.amount ? `${ing.amount} ` : '';
      const unit = ing.unit ? `${ing.unit} ` : '';
      const name = ing.name || (isEn ? 'Ingredient' : 'Bahan');
      text += `• ${amount}${unit}${name}\n`;
    }
  }

  text += isEn ? `\nINSTRUCTIONS:\n` : `\nCARA MEMBUAT:\n`;
  const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
  if (steps.length === 0) {
    text += isEn ? `1. Mix all ingredients until well combined.\n` : `1. Campurkan semua bahan hingga merata.\n`;
  } else {
    steps.forEach((step, idx) => {
      const num = step.index || (idx + 1);
      const instruction = step.instruction || (isEn ? 'Follow cooking instructions.' : 'Lakukan langkah memasak.');
      text += `${num}. ${instruction}\n`;
    });
  }

  const tips = Array.isArray(recipe.tips) ? recipe.tips : [];
  if (tips.length > 0) {
    text += `\nTIPS:\n`;
    for (const tip of tips) {
      text += `• ${tip}\n`;
    }
  }

  return text;
}

export function buildRecipeSocialPackage(recipe = {}, copy = {}) {
  const lang = (copy.lang || copy.targetLanguage || 'id').toLowerCase();
  const isEn = lang.startsWith('en');

  const defaultHook = isEn
    ? 'Quick & delicious recipe you can make in minutes! ✨'
    : 'Rahasia resep enak 3 menit di rumah! ✨';
  const defaultCta = isEn
    ? 'Save & share this recipe! Check the link in bio for details! 👇'
    : 'Simpan & bagikan resep ini! Cek produk di keranjang/link bio ya! 👇';

  const hook = copy.hook || defaultHook;
  const cta = copy.cta || defaultCta;
  const plainRecipe = formatRecipeTextPlain(recipe, { lang });

  const defaultHashtags = isEn
    ? ['#Recipe', '#HealthyRecipes', '#QuickMeals', '#Foodie', '#EasyRecipe']
    : ['#ResepViral', '#ResepPraktis', '#KulinerTikTok', '#ResepMudah', '#HomeCafe'];

  const hashtags = Array.isArray(copy.hashtags) && copy.hashtags.length > 0 ? copy.hashtags : defaultHashtags;
  const hashtagsStr = hashtags.join(' ');

  const fullCaption = `${hook}\n\n${plainRecipe}\n\n${cta}\n\n${hashtagsStr}`.trim();

  return {
    caption: fullCaption,
    caption_with_recipe: fullCaption,
    caption_short: fullCaption,
    hashtags,
    cta,
    call_to_action: cta,
    platform_captions: {
      tiktok: fullCaption,
      instagram: fullCaption,
      youtube_shorts: fullCaption,
      facebook: fullCaption
    }
  };
}
