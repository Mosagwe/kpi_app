import { createConfigService } from "./configService.js";
import { createRefinementService } from "./refinementService.js";
import { createWorkbookService } from "./workbookService.js";
import { createWorkspaceService } from "./workspaceService.js";
import { createOpenAiRefinementGateway } from "../infrastructure/ai/openaiRefinementGateway.js";
import { getProxyConfig } from "../infrastructure/config/env.js";
import { createWorkspaceRepository } from "../infrastructure/database/mongoDatabase.js";
import { createExcelWorkbookGateway } from "../infrastructure/workbook/excelWorkbookGateway.js";

export function createServices({ env }) {
  const proxyConfig = () => getProxyConfig(env);
  return {
    config: createConfigService({ env, proxyConfig }),
    refinement: createRefinementService({
      env,
      proxyConfig,
      refinementGateway: createOpenAiRefinementGateway()
    }),
    workbook: createWorkbookService({
      workbookGateway: createExcelWorkbookGateway()
    }),
    workspace: createWorkspaceService({
      workspaceRepository: createWorkspaceRepository()
    })
  };
}
