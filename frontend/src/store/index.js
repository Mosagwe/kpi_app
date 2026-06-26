import { configureStore } from "@reduxjs/toolkit";
import { uiReducer } from "./uiSlice.js";
import { workspaceReducer } from "./workspaceSlice.js";

export const store = configureStore({
  reducer: {
    workspace: workspaceReducer,
    ui: uiReducer
  }
});
