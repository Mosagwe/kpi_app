import { createSlice } from "@reduxjs/toolkit";

const uiSlice = createSlice({
  name: "ui",
  initialState: {
    view: "home",
    saveStatus: "Autosave enabled",
    ai: { configured: false, proxyConfigured: false, proxyError: "", checked: false },
    toast: null
  },
  reducers: {
    setView: (state, action) => {
      state.view = action.payload;
    },
    setSaveStatus: (state, action) => {
      state.saveStatus = action.payload;
    },
    setAiConfig: (state, action) => {
      state.ai = { ...action.payload, checked: true };
    },
    showToast: (state, action) => {
      state.toast = { id: crypto.randomUUID(), ...action.payload };
    },
    clearToast: (state) => {
      state.toast = null;
    }
  }
});

export const uiActions = uiSlice.actions;
export const uiReducer = uiSlice.reducer;
