import { create } from "zustand";

type UiState = {
  selectedCharacterId: string | null;
  setSelectedCharacterId: (id: string | null) => void;
};

export const useUiStore = create<UiState>((set) => ({
  selectedCharacterId: null,
  setSelectedCharacterId: (id) => set({ selectedCharacterId: id }),
}));
