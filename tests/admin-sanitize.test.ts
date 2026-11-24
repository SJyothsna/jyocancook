import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRecipe, sanitizeConfig } from '../src/lib/admin-sanitize.ts';

describe('Recipe and Configuration Sanitization', () => {
  it('should sanitize and preserve story, nutrition, step images, and ingredient sections', () => {
    const sanitized = sanitizeRecipe({
      title: 'Chicken Kurma Restaurant Style',
      slug: 'chicken-kurma-restaurant-style',
      category: 'curries',
      subcategories: ['Rice Dishes', 'Vegetarian', 'rice-dishes'],
      story: 'A wonderful homestyle kurma recipe passed down through generations.',
      tags: ['Chicken', 'Dinner'],
      diets: ['Vegetarian', 'Vegan', 'Vegan', ''],
      prepTime: '15',
      cookTime: '35',
      servings: '4',
      difficulty: 'Easy',
      published: true,
      nutrition: {
        calories: '380',
        carbs: '22.5',
        protein: '28.1',
        fat: '14.0',
        fiber: '3.5',
      },
      ingredients: [
        { name: 'Chicken', amount: 500, unit: 'g', section: 'Main' },
        { name: 'Onions', amount: 2, unit: 'piece', section: 'Gravy' },
      ],
      steps: [
        { title: 'Sauté', text: 'Sauté onions until golden.', image: '/images/recipes/step1.jpg' },
      ],
    });

    assert.strictEqual(sanitized.slug, 'chicken-kurma-restaurant-style');
    assert.deepStrictEqual(sanitized.subcategories, ['rice-dishes', 'vegetarian']);
    assert.deepStrictEqual(sanitized.diets, ['Vegetarian', 'Vegan']);
    assert.strictEqual(sanitized.story, 'A wonderful homestyle kurma recipe passed down through generations.');
    assert.strictEqual(sanitized.nutrition?.calories, 380);
    assert.strictEqual(sanitized.nutrition?.carbs, 22.5);
    assert.strictEqual(sanitized.nutrition?.protein, 28.1);
    assert.strictEqual(sanitized.ingredients[0].section, 'Main');
    assert.strictEqual(sanitized.steps[0].image, '/images/recipes/step1.jpg');
  });

  it('a recipe has one or more diets; the older single diet value is still accepted', () => {
    const base = { title: 'Dosa', slug: 'dosa', category: 'breakfast', ingredients: [{ name: 'Rice', amount: 1, unit: 'cup' }], steps: [{ title: 'a', text: 'b' }] };
    assert.deepStrictEqual(sanitizeRecipe({ ...base, diet: 'Vegan' }).diets, ['Vegan']);
    assert.deepStrictEqual(sanitizeRecipe(base).diets, ['Vegetarian']);
  });

  it('sub categories are a plain list of unique slugs, with no category', () => {
    assert.deepStrictEqual(sanitizeConfig('subcategories', [{ name: 'Non Veg', category: 'Curries', order: 2 }]), [
      { slug: 'non-veg', name: 'Non Veg', order: 2 },
    ]);
    assert.throws(() => sanitizeConfig('subcategories', [{ name: 'Veg' }, { name: 'Veg' }]), /Duplicate/);
  });

  it('categories keep their sub category slugs as a unique, normalised list', () => {
    const [cat] = sanitizeConfig('categories', [
      { name: 'Curries', subcategories: ['Non Veg', 'vegetarian', 'non-veg'] },
    ]) as unknown as Array<{ slug: string; subcategories: string[] }>;
    assert.strictEqual(cat.slug, 'curries');
    assert.deepStrictEqual(cat.subcategories, ['non-veg', 'vegetarian']);
  });
});
