export type EngravingPosition = "bottom" | "right" | "left";
export type EngravingFontId = 'classic'|'modern'|'script'|'typewriter';
export type RingEngravingConfig = { text: string; position: EngravingPosition; font?:EngravingFontId };
export const ENGRAVING_FONTS: {id:EngravingFontId;label:string;family:string}[]=[
 {id:'classic',label:'Classic',family:'RB Classic'},
 {id:'modern',label:'Modern',family:'RB Modern'},
 {id:'script',label:'Script',family:'RB Script'},
 {id:'typewriter',label:'Typewriter',family:'RB Typewriter'},
];
export const engravingFont=(id?:string)=>ENGRAVING_FONTS.find(font=>font.id===(id||'classic'))||ENGRAVING_FONTS[0];
const fontLoads=new Map<string,Promise<void>>();
export async function ensureEngravingFont(id?:string){
 if(typeof document==='undefined'||!document.fonts?.load)return;
 const font=engravingFont(id);let loading=fontLoads.get(font.id);
 if(!loading){loading=document.fonts.load(`400 24px "${font.family}"`).then(faces=>{if(!faces.length)throw Error('The engraving font could not load. Please try again.');}).catch(error=>{fontLoads.delete(font.id);throw error;});fontLoads.set(font.id,loading);}
 return loading;
}
export type EngravingStatus = "idle" | "applying" | "ready" | "unavailable";
export const ENGRAVING_MAX_CHARACTERS = 24;
export const ENGRAVING_POSITIONS: { id: EngravingPosition; label: string; angle: number }[] = [
  { id: "bottom", label: "Bottom", angle: 0 },
  { id: "right", label: "Right", angle: Math.PI / 2 },
  { id: "left", label: "Left", angle: -Math.PI / 2 },
];
export const normalizeEngravingText = (text: string) => text.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
export const engravingTextError = (text: string) => {
  const value = normalizeEngravingText(text);
  if (!value) return "Enter the text you would like inside your ring.";
  if (Array.from(value).length > ENGRAVING_MAX_CHARACTERS) return `Use up to ${ENGRAVING_MAX_CHARACTERS} characters.`;
  return "";
};
