# Defects to fix

1. [FIXED] Admin page, Navigation menu, Categories, Sub categories and Diets tabs: the order is no longer typed in an "order" number column. Each row has up and down arrows to move it, and the order is saved from the row positions.
2. [FIXED] Add / update recipe: Diet is now a set of tick boxes instead of a drop down, so a recipe can have more than one diet (for example Vegetarian and Vegan). It is listed on every diet page it belongs to, and its card and filters show all of them. Production needs the one-off `ALTER TABLE recipes MODIFY diet VARCHAR(120) NOT NULL DEFAULT 'Vegetarian';` (the migration does it too).
3. [FIXED] Add / update recipe: a recipe saved without a Diet silently defaults to Vegetarian, so a non-veg recipe can end up on the Vegetarian page. At least one Diet must now be chosen.
4. [FIXED] Diets: the admin has a Diets tab where diets (Vegetarian, Non-Vegetarian, Vegan...) are added, renamed and ordered. The recipe Diet dropdown uses that list, and each diet gets its own page at `/category/<diet slug>/`.
5. [FIXED] Admin page, Manage categories: when a category has many sub categories, the category name is not shown fully.
6. [FIXED] Add / update recipe: when adding instructions under a section, I should be able to format them as bullet points, either numbered or dotted.
7. [FIXED] Add recipe / recipe page: "tbsp" should be displayed as "Tbsp" (first letter capital).
8. [FIXED] Add / update recipe: ingredients and sections should be movable up and down.
9. [FIXED] Menu: Vegetarian / Non-Vegetarian pages showed no recipes after those categories were removed in Manage categories. The pages are now always published and list recipes by their Diet.
10. [FIXED] Recipe page: servings is displayed as `2 1/5` instead of `2.5`.
11. [FIXED] Add recipe: when instructions are added under a section, each instruction is entered on a separate line but everything is displayed as one paragraph. The line breaks should be retained.
12. [FIXED] Recipe page: in the recipe title area, there is empty space next to the description. The widths of the title, description and other elements in the recipe title area are not consistent.
13. [FIXED] Recipe page: add "Recipe by" below the recipe title.
14. [FIXED] Recipe page: a tag can repeat the category chip (for example "Breakfast" appears twice on Masala Dosa) because the page renders the category chip and every tag from the data.
