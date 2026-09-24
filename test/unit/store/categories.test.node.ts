import { isEqual } from 'lodash';
import { setActivePinia, createPinia } from 'pinia';

import { useCategoryStore } from '~/stores/categories';
import { useSettingsStore } from '~/stores/settings';
import { createMissingParents, defaultCategories, Category } from '~/util/classes';
import { buildExactRulePattern } from '~/util/categorization';

describe('categories store', () => {
  setActivePinia(createPinia());
  const categoryStore = useCategoryStore();

  beforeEach(() => {
    categoryStore.clearAll();
  });

  test('loads default categories', async () => {
    // Load categories
    expect(categoryStore.classes).toHaveLength(0);
    categoryStore.restoreDefaultClasses();

    expect(categoryStore.classes_unsaved_changes).toBeTruthy();
    await categoryStore.save();

    expect(categoryStore.classes_unsaved_changes).toBeFalsy();
    expect(categoryStore.classes).not.toHaveLength(0);

    // Retrieve class
    let workCat = categoryStore.get_category(['Work']);
    expect(workCat).not.toBeUndefined();
    workCat = JSON.parse(JSON.stringify(workCat)); // copy

    // Modify class
    const newRegex = 'Just testing';
    workCat.rule.regex = newRegex;
    categoryStore.updateClass(workCat);
    expect(categoryStore.get_category(['Work']).rule.regex).toEqual(newRegex);

    // Check that getters behave somewhat
    expect(categoryStore.all_categories).not.toHaveLength(0);
    expect(categoryStore.classes_hierarchy).not.toHaveLength(0);
  });

  test('loads custom categories', () => {
    expect(categoryStore.classes).toHaveLength(0);
    categoryStore.load([{ name: ['Test'], rule: { type: 'none' } }]);
    expect(categoryStore.all_categories).toHaveLength(1);
  });

  test('accepted correction rules survive category serialization and reload', () => {
    categoryStore.load([{ name: ['Work'], rule: { type: 'none' } }]);
    const category = categoryStore.get_category(['Work']);
    const pattern = buildExactRulePattern('C++ [Plan]');
    categoryStore.appendClassRule(category.id as number, pattern as string);

    const serialized = JSON.parse(JSON.stringify(categoryStore.classes_clean));
    categoryStore.load(serialized);

    expect(categoryStore.classes_for_query).toEqual([
      [['Work'], { type: 'regex', regex: '^C\\+\\+ \\[Plan\\]$' }],
    ]);
  });

  test('waits for settings persistence before marking rules saved', async () => {
    const settingsStore = useSettingsStore();
    categoryStore.load([{ name: ['Work'], rule: { type: 'none' } }]);
    categoryStore.appendClassRule(categoryStore.classes[0].id as number, '^Editor$');

    let finishSave = () => {
      throw new Error('Persistence resolver was not initialized.');
    };
    const persistence = new Promise<void>(resolve => {
      finishSave = resolve;
    });
    const update = jest.spyOn(settingsStore, 'update').mockReturnValue(persistence);
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const saving = categoryStore.save();
      expect(saving).toBeInstanceOf(Promise);
      expect(categoryStore.classes_unsaved_changes).toBe(true);
      finishSave();
      await saving;
      expect(update).toHaveBeenCalledTimes(1);
      expect(categoryStore.classes_unsaved_changes).toBe(false);
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
      update.mockRestore();
    }
  });

  test('get category hierarchy', () => {
    categoryStore.restoreDefaultClasses();
    const hier = categoryStore.classes_hierarchy;
    expect(hier).not.toHaveLength(0);
  });

  test('create missing parents', () => {
    const cats = createMissingParents([
      { name: ['Test', 'Subcat'], rule: { type: 'regex', regex: 'test' } },
    ]);
    expect(cats).toHaveLength(2);
  });

  test('update implicit parent category', () => {
    // The default categories have implicit Media and Comms categories (with 'No Rule')
    // Tests against https://github.com/ActivityWatch/activitywatch/issues/580
    categoryStore.restoreDefaultClasses();

    // Check that the label is available
    expect(categoryStore.all_categories).toContainEqual(['Media']);

    // Get category and modify it
    const media_cat: Category = categoryStore.get_category(['Media']);
    expect(media_cat.id).not.toBeUndefined();
    const new_media_cat = { ...media_cat, name: ['Media2'], data: { test: true } };
    categoryStore.updateClass(new_media_cat);

    // Check that category was modified correctly
    const media2_cat: Category = categoryStore.get_category(['Media2']);
    expect(media2_cat.data.test).toBe(true);

    // Check that child was modified correctly when parent name changed
    const music_cat = categoryStore.get_category(['Media2', 'Music']);
    expect(music_cat.id).not.toBeUndefined();

    // Check that defaultCategories haven't mutated
    expect(defaultCategories.map(c => c.name)).toContainEqual(['Media', 'Music']);
  });

  test('modify a category after deleting another', () => {
    // Deleting a category, then modifying another with an ID subsequent to it, should not
    // cause the changes to be applied to unintended classes.
    // Test against:
    // https://github.com/ActivityWatch/activitywatch/issues/361#issuecomment-970707045
    categoryStore.restoreDefaultClasses();

    // Check that Image category is available
    expect(categoryStore.all_categories).toContainEqual(['Work', 'Image']);

    // Delete Image category
    const image_cat = categoryStore.get_category(['Work', 'Image']);
    const image_cat_id = image_cat.id;
    expect(image_cat_id).not.toBeUndefined();
    categoryStore.removeClass(image_cat_id);

    // Check that Image category no longer exists
    expect(categoryStore.all_categories).not.toContainEqual(['Work', 'Image']);

    // Get Video category (whose ID succeeds to that of Image) and modify it
    const video_cat: Category = categoryStore.get_category(['Work', 'Video']);
    const video_cat_id = video_cat.id;
    expect(video_cat_id).not.toBeUndefined();
    expect(video_cat_id).toBeGreaterThan(image_cat_id);
    const new_video_cat: Category = {
      ...video_cat,
      name: ['Work', 'Video2'],
      data: { test: true },
    };
    categoryStore.updateClass(new_video_cat);

    // Check that modification on Video was applied
    const video_2_cat = categoryStore.get_category_by_id(video_cat_id);
    expect(video_2_cat.data.test).toBe(true);

    // Check that the category named "Video" no longer exists, and the category named "Video2" exists
    expect(categoryStore.all_categories.filter(c => isEqual(c, ['Work', 'Video']))).toHaveLength(0);
    expect(categoryStore.all_categories.filter(c => isEqual(c, ['Work', 'Video2']))).toHaveLength(
      1
    );
  });

  test('get_category_color decodes URL-encoded category segments', () => {
    categoryStore.load([
      {
        name: ['Work Project'],
        rule: { type: 'regex', regex: 'work-project' },
        data: { color: '#123456' },
      } as Category,
    ]);

    const decoded = categoryStore.get_category_color(['Work Project']);
    const encoded = categoryStore.get_category_color(['Work%20Project']);

    expect(decoded).toEqual('#123456');
    expect(encoded).toEqual('#123456');
  });

  test('get_category_score decodes URL-encoded category segments', () => {
    categoryStore.load([
      {
        name: ['Work Project'],
        rule: { type: 'regex', regex: 'work-project' },
        data: { score: 42 },
      } as Category,
    ]);

    const decoded = categoryStore.get_category_score(['Work Project']);
    const encoded = categoryStore.get_category_score(['Work%20Project']);

    expect(decoded).toEqual(42);
    expect(encoded).toEqual(42);
  });
});
