import { create } from 'zustand';
import api from '../services/api';

export interface FieldDefinition {
  name: string;
  label: string;
  type:
    | 'text'
    | 'number'
    | 'currency'
    | 'email'
    | 'phone'
    | 'date'
    | 'dropdown'
    | 'multiselect'
    | 'checkbox'
    | 'switch'
    | 'rating'
    | 'file'
    | 'image'
    | 'formula'
    | 'rich-text'
    | 'signature'
    | 'url';
  required: boolean;
  unique: boolean;
  regexValidation?: string;
  defaultValue?: string;
  formulaExpression?: string;
  options?: string[];
  conditionalVisibility?: {
    dependsOnField: string;
    conditionValue: string;
  };
}

export interface RelationshipDefinition {
  targetModule: string;
  type: 'one-to-many' | 'many-to-one' | 'many-to-many';
  fieldName: string;
}

export interface ModuleDefinition {
  _id: string;
  name: string;
  singularLabel: string;
  pluralLabel: string;
  apiPath: string;
  icon: string;
  isSystem: boolean;
  fields: FieldDefinition[];
  relationships: RelationshipDefinition[];
}

interface ModuleState {
  modules: ModuleDefinition[];
  loadingModules: boolean;
  activeModule: ModuleDefinition | null;
  fetchModules: () => Promise<ModuleDefinition[]>;
  setActiveModuleByPath: (path: string) => Promise<void>;
  addModule: (module: ModuleDefinition) => void;
}

export const useModuleStore = create<ModuleState>((set, get) => ({
  modules: [],
  loadingModules: false,
  activeModule: null,

  fetchModules: async () => {
    set({ loadingModules: true });
    try {
      const res = await api.get('/modules');
      set({ modules: res.data, loadingModules: false });
      return res.data;
    } catch (err) {
      console.error('Failed to load modules:', err);
      set({ loadingModules: false });
      return [];
    }
  },

  setActiveModuleByPath: async (path) => {
    let mods = get().modules;
    if (!mods || mods.length === 0) {
      mods = await get().fetchModules();
    }
    const active = (mods || []).find(
      (m) => m.apiPath.toLowerCase() === path.toLowerCase()
    );
    set({ activeModule: active || null });
  },

  addModule: (module) => {
    set({ modules: [...get().modules, module] });
  }
}));
