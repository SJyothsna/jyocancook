import categoriesData from '../../config/categories.json';
import subcategoriesData from '../../config/subcategories.json';
import dietsData from '../../config/diets.json';
import menuData from '../../config/menu.json';
import tagsData from '../../config/tags.json';
export type Ingredient = {amount:number|null;unit:string;name:string;section?:string};
export type Nutrition = {calories?:number;carbs?:number;protein?:number;fat?:number;fiber?:number};
export type Recipe = {slug:string;title:string;description:string;category:string;subcategories?:string[];tags:string[];diet:string;prepTime:number;cookTime:number;servings:number;difficulty:string;image:string;published:boolean;featured?:boolean;publishedAt?:string;story?:string;ingredients:Ingredient[];steps:{title:string;text:string;image?:string}[];tips?:string[];serveWith?:string[];youtubeUrl?:string;nutrition?:Nutrition};
export type Category = {slug:string;name:string;description:string;image?:string;emoji?:string;order:number;subcategories?:string[]};
export type Subcategory = {slug:string;name:string;order:number};
export type Diet = {slug:string;name:string;order:number};
const modules = import.meta.glob('../content/recipes/*.json', {eager:true, import:'default'});
export const categories = (categoriesData as Category[]).sort((a,b)=>a.order-b.order);
export const subcategories = (subcategoriesData as Subcategory[]).sort((a,b)=>a.order-b.order);
// A recipe keeps only the sub categories its own category offers (stale or legacy values are ignored).
const validSubcategories = (r:Recipe)=>{
  const offered = categories.find(c=>c.slug===r.category)?.subcategories ?? [];
  return (r.subcategories??[]).filter(s=>offered.includes(s)&&subcategories.some(x=>x.slug===s));
};
export const recipes = (Object.values(modules).filter((r:any)=>r.published).sort((a:any,b:any)=>a.title.localeCompare(b.title)) as Recipe[])
  .map(r=>({...r,subcategories:validSubcategories(r)}));
export const diets = (dietsData as Diet[]).sort((a,b)=>a.order-b.order);
export const subcategoryName = (slug:string)=>subcategories.find(s=>s.slug===slug)?.name ?? slug;
export const tags = tagsData as string[];
export const menu = menuData.filter(x=>x.visible).sort((a,b)=>a.order-b.order);
export const categoryName = (slug:string)=>categories.find(x=>x.slug===slug)?.name ?? slug;
export const recipeUrl = (r:Recipe)=>`/recipes/${r.slug}/`;
