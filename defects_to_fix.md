# Defects to fix

1. [FIXED] Add / update recipe: a recipe saved without a Diet silently defaults to Vegetarian, so a non-veg recipe can end up on the Vegetarian page. The Diet is now a required field with a "Choose diet" placeholder.
2. [FIXED] Diets: the admin has a Diets tab where diets (Vegetarian, Non-Vegetarian, Vegan...) are added, renamed and ordered. The recipe Diet dropdown uses that list, and each diet gets its own page at `/category/<diet slug>/`.
3. [FIXED] Admin page, Manage categories: when a category has many sub categories, the category name is not shown fully.
4. [FIXED] Add / update recipe: when adding instructions under a section, I should be able to format them as bullet points, either numbered or dotted.
5. [FIXED] Add recipe / recipe page: "tbsp" should be displayed as "Tbsp" (first letter capital).
6. [FIXED] Add / update recipe: ingredients and sections should be movable up and down.
7. [FIXED] Menu: Vegetarian / Non-Vegetarian pages showed no recipes after those categories were removed in Manage categories. The pages are now always published and list recipes by their Diet.
8. [FIXED] Recipe page: servings is displayed as `2 1/5` instead of `2.5`.
9. [FIXED] Add recipe: when instructions are added under a section, each instruction is entered on a separate line but everything is displayed as one paragraph. The line breaks should be retained.
10. [FIXED] Recipe page: in the recipe title area, there is empty space next to the description. The widths of the title, description and other elements in the recipe title area are not consistent.
11. [FIXED] Recipe page: add "Recipe by" below the recipe title.
12. [FIXED] Recipe page: a tag can repeat the category chip (for example "Breakfast" appears twice on Masala Dosa) because the page renders the category chip and every tag from the data.
