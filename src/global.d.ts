export {};

declare global {
  // jQuery / toastr are globals in SillyTavern
  const $: any;
  const jQuery: any;
  const toastr: any;

  interface SillyTavernGlobal {
    libs?: Record<string, any>;
    getContext?: () => any;
  }

  // NOTE: SillyTavern exposes itself as a global object on window/globalThis.
  // In ES modules, it's safest to access it via `globalThis.SillyTavern`.
  const SillyTavern: SillyTavernGlobal | undefined;

  type HiganbanaProjectManagePayload = {
    targetProjectId?: string;
    targetZipSha256?: string;
    source?: 'embedded' | 'url' | 'local';
    title?: string;
    placeholder?: string;
    homePage?: string;
    showTitleInChat?: boolean;
    fixRootRelativeUrls?: boolean;
    zipName?: string;
    zipSha256?: string;
    zipUrl?: string;
    zipBase64?: string;
    /** 明确表示“待导入的新 zip（base64）”；存在时会触发导入+覆盖 */
    importZipBase64?: string;
    zipArrayBuffer?: ArrayBuffer | Uint8Array;
    zipBlob?: Blob;
    preferredHomePage?: string;
    persistEmbeddedToCard?: boolean;
    reloadChat?: boolean;
  };

  type HiganbanaProjectQueryPayload = {
    targetProjectId?: string;
    targetZipSha256?: string;
    includeAll?: boolean;
  };

  type HiganbanaProjectCreatePayload = Omit<HiganbanaProjectManagePayload, 'targetProjectId' | 'targetZipSha256'>;
  type HiganbanaProjectDeletePayload = Pick<HiganbanaProjectManagePayload, 'targetProjectId' | 'targetZipSha256' | 'reloadChat'>;

  type HiganbanaGlobalApi = {
    /** 读取项目配置：可读当前项目、指定项目或全部项目 */
    getProject: (payload?: HiganbanaProjectQueryPayload) => Promise<any>;
    /** 兼容旧命名，等价于 getProject */
    getProjectConfig?: (payload?: HiganbanaProjectQueryPayload) => Promise<any>;
    /** 创建新项目：支持 URL / local / embedded，也支持传 zipArrayBuffer/zipBlob/importZipBase64 导入后创建 */
    createProject: (payload?: HiganbanaProjectCreatePayload) => Promise<any>;
    /**
     * 通用更新入口：
     * - 仅改字段：直接覆盖项目配置
     * - 传 zipArrayBuffer / zipBlob / importZipBase64：先导入 zip，再覆盖项目
     * - 未传 targetProjectId/targetZipSha256 时，默认尝试更新“当前项目”
     */
    updateProject: (payload?: HiganbanaProjectManagePayload) => Promise<any>;
    /** 删除项目：不传 target 时默认尝试删除“当前项目” */
    deleteProject: (payload?: HiganbanaProjectDeletePayload) => Promise<any>;
  };

  interface Window {
    Higanbana?: HiganbanaGlobalApi;
    higanbana?: HiganbanaGlobalApi;
  }

  interface GlobalThis {
    SillyTavern?: SillyTavernGlobal;
    Higanbana?: HiganbanaGlobalApi;
    higanbana?: HiganbanaGlobalApi;
  }
}

