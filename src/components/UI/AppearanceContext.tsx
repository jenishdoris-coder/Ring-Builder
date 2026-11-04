import {createContext,useContext,type ReactNode} from 'react';
import {DEFAULT_APPEARANCE} from '../../config/appearance';
import type {BuilderAppearance} from '../../types/appearance';
const Context=createContext<BuilderAppearance>(DEFAULT_APPEARANCE);
export const AppearanceProvider=({value,children}:{value?:BuilderAppearance;children:ReactNode})=><Context.Provider value={value||DEFAULT_APPEARANCE}>{children}</Context.Provider>;
export const useAppearance=()=>useContext(Context);
