# Defects to fix

1. [FIXED] Add recipe: the recipe image field was pre-filled with another recipe's photo (`andhra-chicken-curry.png`). It is now empty for a new recipe; it fills in when a photo is uploaded, and a recipe saved without one uses the placeholder image.
2. [FIXED] Admin page, Navigation menu, Categories, Sub categories and Diets tabs: the order is no longer typed in an "order" number column. Each row has up and down arrows to move it, and the order is saved from the row positions.
3. [FIXED] Add / update recipe: Diet is now a set of tick boxes instead of a drop down, so a recipe can have more than one diet (for example Vegetarian and Vegan). It is listed on every diet page it belongs to, and its card and filters show all of them. Production needs the one-off `ALTER TABLE recipes MODIFY diet VARCHAR(120) NOT NULL DEFAULT 'Vegetarian';` (the migration does it too).
4. [FIXED] Add / update recipe: a recipe saved without a Diet silently defaults to Vegetarian, so a non-veg recipe can end up on the Vegetarian page. At least one Diet must now be chosen.
5. [FIXED] Diets: the admin has a Diets tab where diets (Vegetarian, Non-Vegetarian, Vegan...) are added, renamed and ordered. The recipe Diet dropdown uses that list, and each diet gets its own page at `/category/<diet slug>/`.
6. [FIXED] Admin page, Manage categories: when a category has many sub categories, the category name is not shown fully.
7. [FIXED] Add / update recipe: when adding instructions under a section, I should be able to format them as bullet points, either numbered or dotted.
8. [FIXED] Add recipe / recipe page: "tbsp" should be displayed as "Tbsp" (first letter capital).
9. [FIXED] Add / update recipe: ingredients and sections should be movable up and down.
10. [FIXED] Menu: Vegetarian / Non-Vegetarian pages showed no recipes after those categories were removed in Manage categories. The pages are now always published and list recipes by their Diet.
11. [FIXED] Recipe page: servings is displayed as `2 1/5` instead of `2.5`.
12. [FIXED] Add recipe: when instructions are added under a section, each instruction is entered on a separate line but everything is displayed as one paragraph. The line breaks should be retained.
13. [FIXED] Recipe page: in the recipe title area, there is empty space next to the description. The widths of the title, description and other elements in the recipe title area are not consistent.
14. [FIXED] Recipe page: add "Recipe by" below the recipe title.
15. [FIXED] Recipe page: a tag can repeat the category chip (for example "Breakfast" appears twice on Masala Dosa) because the page renders the category chip and every tag from the data.
