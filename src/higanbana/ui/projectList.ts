import type { HiganbanaProject } from '../card';
import { bindCocktailLikeSubpanels } from './subpanels';

export function renderProjectsList(projects: HiganbanaProject[]): void {
  const container = document.getElementById('hb_projects_list');
  if (!container) return;
  container.innerHTML = '';

  if (projects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hb-subhint';
    empty.textContent = '（暂无项目）';
    container.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const proj of projects) {
    const section = document.createElement('section');
    section.className = 'hb-subpanel hb-project';
    section.dataset.id = `project_${proj.id}`;
    section.dataset.projectId = proj.id;

    const header = document.createElement('button');
    header.className = 'hb-subpanel-header';
    header.type = 'button';
    header.setAttribute('aria-expanded', 'false');

    const title = document.createElement('div');
    title.className = 'hb-subpanel-title';
    title.textContent = `${proj.title || proj.zipName}  ${proj.placeholder}`;

    const indicator = document.createElement('div');
    indicator.className = 'hb-subpanel-indicator';
    indicator.textContent = '+';

    header.appendChild(title);
    header.appendChild(indicator);
    section.appendChild(header);

    const body = document.createElement('div');
    body.className = 'hb-subpanel-body';
    body.style.display = 'none';

    const mkRow = (labelText: string): HTMLDivElement => {
      const row = document.createElement('div');
      row.className = 'hb-row';
      const label = document.createElement('label');
      label.className = 'hb-label';
      label.textContent = labelText;
      row.appendChild(label);
      return row;
    };

    // Title (editable)
    {
      const row = mkRow('标题');
      const input = document.createElement('input');
      input.className = 'text_pole hb-proj-title';
      input.type = 'text';
      input.spellcheck = false;
      input.value = proj.title || '';
      input.dataset.projectId = proj.id;
      row.appendChild(input);
      body.appendChild(row);
    }

    // Placeholder (editable) + actions
    {
      const row = mkRow('占位符');
      const input = document.createElement('input');
      input.className = 'text_pole hb-proj-placeholder';
      input.type = 'text';
      input.spellcheck = false;
      input.value = proj.placeholder;
      input.dataset.projectId = proj.id;
      row.appendChild(input);

      const actions = document.createElement('div');
      actions.className = 'hb-actions';
      const btnCopy = document.createElement('button');
      btnCopy.className = 'menu_button';
      btnCopy.type = 'button';
      btnCopy.dataset.hbAction = 'copy_placeholder';
      btnCopy.dataset.projectId = proj.id;
      btnCopy.textContent = '复制';
      const btnInsert = document.createElement('button');
      btnInsert.className = 'menu_button';
      btnInsert.type = 'button';
      btnInsert.dataset.hbAction = 'insert_placeholder';
      btnInsert.dataset.projectId = proj.id;
      btnInsert.textContent = '插入到输入框';
      actions.appendChild(btnCopy);
      actions.appendChild(btnInsert);
      row.appendChild(actions);

      body.appendChild(row);
    }

    // Home page (editable)
    {
      const row = mkRow('入口 HTML');
      const input = document.createElement('input');
      input.className = 'text_pole hb-proj-home';
      input.type = 'text';
      input.spellcheck = false;
      input.value = proj.homePage;
      input.dataset.projectId = proj.id;
      row.appendChild(input);
      body.appendChild(row);
    }

    // Fix root-relative urls
    {
      const row = mkRow('修复 root 相对路径（/xxx）');
      const input = document.createElement('input');
      input.className = 'hb-proj-fix';
      input.type = 'checkbox';
      input.checked = Boolean(proj.fixRootRelativeUrls);
      input.dataset.projectId = proj.id;
      row.appendChild(input);
      body.appendChild(row);
    }

    // Show title bar in chat
    {
      const row = mkRow('消息列表显示标题');
      const input = document.createElement('input');
      input.className = 'hb-proj-show-title';
      input.type = 'checkbox';
      input.checked = Boolean(proj.showTitleInChat);
      input.dataset.projectId = proj.id;
      row.appendChild(input);
      body.appendChild(row);
    }

    // Actions: import/export/download/apply/open/delete
    {
      const row = mkRow('操作');
      const actions = document.createElement('div');
      actions.className = 'hb-actions';

      if (proj.source === 'embedded') {
        const btnImport = document.createElement('button');
        btnImport.className = 'menu_button';
        btnImport.type = 'button';
        btnImport.dataset.hbAction = 'import_cache';
        btnImport.dataset.projectId = proj.id;
        btnImport.textContent = '导入到缓存';
        actions.appendChild(btnImport);

        const btnExport = document.createElement('button');
        btnExport.className = 'menu_button';
        btnExport.type = 'button';
        btnExport.dataset.hbAction = 'export_zip';
        btnExport.dataset.projectId = proj.id;
        btnExport.textContent = '导出 zip';
        actions.appendChild(btnExport);
      } else if (proj.source === 'url') {
        const btnDl = document.createElement('button');
        btnDl.className = 'menu_button';
        btnDl.type = 'button';
        btnDl.dataset.hbAction = 'download_apply';
        btnDl.dataset.projectId = proj.id;
        btnDl.textContent = '下载并应用';
        actions.appendChild(btnDl);
      } else {
        const btnLocal = document.createElement('button');
        btnLocal.className = 'menu_button';
        btnLocal.type = 'button';
        btnLocal.disabled = true;
        btnLocal.title = '仅使用本地缓存。若缓存被清理，请在“新增项目”中重新导入 zip。';
        btnLocal.textContent = '本地缓存模式';
        actions.appendChild(btnLocal);
      }

      const btnOpen = document.createElement('button');
      btnOpen.className = 'menu_button';
      btnOpen.type = 'button';
      btnOpen.dataset.hbAction = 'open_home';
      btnOpen.dataset.projectId = proj.id;
      btnOpen.textContent = '打开首页';
      actions.appendChild(btnOpen);

      const btnDelete = document.createElement('button');
      btnDelete.className = 'menu_button';
      btnDelete.type = 'button';
      btnDelete.dataset.hbAction = 'delete_project';
      btnDelete.dataset.projectId = proj.id;
      btnDelete.textContent = '删除项目';
      actions.appendChild(btnDelete);

      row.appendChild(actions);
      body.appendChild(row);
    }

    section.appendChild(body);
    frag.appendChild(section);
  }
  container.appendChild(frag);
  // Bind newly added subpanels
  bindCocktailLikeSubpanels();
}

