class IntoGroupBitrixService {
    constructor() {
        this.baseUrl = 'https://intogroup.bitrix24.ru/rest/18/ucbradji55w3rn5h';
        this.rateLimit = {
            lastCall: 0,
            delay: 1000
        };
        this.cache = new Map();
    }

    async callMethod(method, params = {}) {
        const cacheKey = `${method}-${JSON.stringify(params)}`;
        const now = Date.now();
        
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (now - cached.timestamp < 300000) {
                return cached.data;
            }
        }

        const timeSinceLastCall = now - this.rateLimit.lastCall;
        if (timeSinceLastCall < this.rateLimit.delay) {
            await this.delay(this.rateLimit.delay - timeSinceLastCall);
        }

        try {
            const urlParams = new URLSearchParams();
            
            for (const key in params) {
                if (params[key] !== undefined && params[key] !== null) {
                    if (typeof params[key] === 'object') {
                        if (key === 'filter') {
                            for (const filterKey in params[key]) {
                                if (params[key][filterKey] !== undefined && params[key][filterKey] !== null && params[key][filterKey] !== '') {
                                    urlParams.append(`filter[${filterKey}]`, params[key][filterKey]);
                                }
                            }
                        } else if (key === 'select') {
                            params[key].forEach((field, index) => {
                                urlParams.append(`select[${index}]`, field);
                            });
                        }
                    } else if (params[key] !== '') {
                        urlParams.append(key, params[key]);
                    }
                }
            }

            const url = `${this.baseUrl}/${method}?${urlParams.toString()}`;
            console.log('API Request:', url);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('API Response:', data);

            if (data.error) {
                throw new Error(data.error_description || data.error);
            }

            this.rateLimit.lastCall = Date.now();
            const result = data.result || data;

            this.cache.set(cacheKey, {
                data: result,
                timestamp: now
            });

            return result;

        } catch (error) {
            console.error('Bitrix API Error:', error);
            if (error.message.includes('QUERY_LIMIT_EXCEEDED')) {
                await this.delay(2000);
                return this.callMethod(method, params);
            }
            throw error;
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async getUsers(params = {}) {
        const result = await this.callMethod('user.get', {
            ...params,
            filter: params.filter || {},
            select: params.select || ['ID', 'NAME', 'LAST_NAME', 'EMAIL', 'UF_DEPARTMENT', 'ACTIVE']
        });
        return result;
    }

   async getTasks(params = {}) {
    const selectFields = [
        'ID', 'TITLE', 'GROUP_ID', 'PARENT_ID', 'RESPONSIBLE_ID', 
        'TIME_ESTIMATE', 'CREATED_DATE', 'TIME_SPENT_IN_LOGS',
        'STATUS', 'CLOSED_DATE', 'DEADLINE'
    ];
    
    let allTasks = [];
    let start = 0;
    const limit = 50;

    do {
        const result = await this.callMethod('tasks.task.list', {
            ...params,
            start: start,
            filter: params.filter || {},
            select: params.select || selectFields,
            order: { ID: 'ASC' }
        });

        console.log('Tasks response:', result);

        // Правильная обработка ответа Bitrix24
        if (result && result.tasks) {
            allTasks = allTasks.concat(result.tasks);
            // Проверяем, есть ли еще задачи
            if (result.tasks.length < limit) {
                break;
            }
            start += limit;
        } else {
            break;
        }

        // Защита от бесконечного цикла
        if (start >= 1000) break;

    } while (true);

    console.log('Всего задач загружено:', allTasks.length);
    return allTasks;
}
    async getProjects(params = {}) {
        const result = await this.callMethod('sonet_group.get', {
            ...params,
            filter: params.filter || {},
            select: params.select || ['ID', 'NAME', 'DESCRIPTION', 'DATE_CREATE']
        });
        return result;
    }

    async getDepartments() {
        const result = await this.callMethod('department.get', {
            select: ['ID', 'NAME', 'PARENT']
        });
        return result;
    }
}

class ResourceManagementApp {
    constructor() {
        this.bitrixService = new IntoGroupBitrixService();
        this.currentData = {
            planFact: [],
            projectResources: []
        };
        this.filters = {
            period: 'month',
            dateFrom: null,
            dateTo: null,
            projectId: '',
            departmentId: ''
        };
    }

    async init() {
        try {
            this.showLoader();
            await this.testAPI();
            await this.loadInitialData();
            this.initUI();
            this.hideLoader();
            this.showApp();
            
            // Загружаем План/Факт при инициализации
            await this.loadPlanFactData();
            
        } catch (error) {
            this.showError('Ошибка инициализации: ' + error.message);
            this.hideLoader();
        }
    }

    async testAPI() {
        try {
            const users = await this.bitrixService.getUsers({ 
                filter: { ACTIVE: true },
                select: ['ID', 'NAME'],
                limit: 1
            });
            console.log('API test successful:', users);
        } catch (error) {
            console.error('API test failed:', error);
            throw new Error('Не удалось подключиться к Bitrix24 API.');
        }
    }

    async loadInitialData() {
        try {
            const [projects, departments] = await Promise.all([
                this.bitrixService.getProjects({ filter: { ACTIVE: 'Y' }, limit: 50 }),
                this.bitrixService.getDepartments()
            ]);

            console.log('Projects:', projects);
            console.log('Departments:', departments);

            this.populateSelect('project-filter', projects, 'NAME', 'ID');
            this.populateSelect('department-filter', departments, 'NAME', 'ID');
        } catch (error) {
            console.error('Error loading initial data:', error);
            this.showError('Ошибка загрузки начальных данных: ' + error.message);
        }
    }

    populateSelect(selectId, data, textKey, valueKey) {
        const select = document.getElementById(selectId);
        select.innerHTML = '<option value="">Все</option>';
        
        if (data && data.length > 0) {
            data.forEach(item => {
                const option = document.createElement('option');
                option.value = item[valueKey];
                option.textContent = item[textKey] || `Элемент ${item[valueKey]}`;
                select.appendChild(option);
            });
        }
    }

    initUI() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        document.getElementById('period-filter').addEventListener('change', (e) => {
            this.filters.period = e.target.value;
            this.toggleCustomPeriod();
        });

        document.getElementById('apply-filters').addEventListener('click', () => {
            this.applyFilters();
        });

        document.getElementById('project-filter').addEventListener('change', () => {
            if (document.getElementById('project-resources-tab').classList.contains('active')) {
                this.loadProjectResourcesData();
            }
        });

        document.getElementById('export-plan-fact').addEventListener('click', () => {
            this.exportToExcel('plan-fact');
        });

        document.getElementById('export-resources').addEventListener('click', () => {
            this.exportToExcel('resources');
        });

        document.getElementById('detail-level').addEventListener('change', (e) => {
            this.loadProjectResourcesData();
        });

        document.getElementById('refresh-btn').addEventListener('click', () => {
            this.refreshData();
        });

        this.initDates();
    }

    initDates() {
    const dateRange = this.bitrixService.getDateRange(this.filters.period);
    document.getElementById('date-from').value = dateRange.from;
    document.getElementById('date-to').value = dateRange.to;
    this.filters.dateFrom = dateRange.from;
    this.filters.dateTo = dateRange.to;
}

    async applyFilters() {
    console.log('✅ applyFilters вызван');

    // 🚀 Сначала обновляем даты, если период не custom
    if (this.filters.period !== 'custom') {
        const dateRange = this.bitrixService.getDateRange(this.filters.period);
        this.filters.dateFrom = dateRange.from;
        this.filters.dateTo = dateRange.to;
        // Опционально: обновляем UI
        document.getElementById('date-from').value = dateRange.from;
        document.getElementById('date-to').value = dateRange.to;
    } else {
        // Для custom берем из инпутов
        this.filters.dateFrom = document.getElementById('date-from').value;
        this.filters.dateTo = document.getElementById('date-to').value;
    }

    this.filters.period = document.getElementById('period-filter').value;
    this.filters.projectId = document.getElementById('project-filter').value;
    this.filters.departmentId = document.getElementById('department-filter').value;

    console.log('Applying filters:', this.filters);

    if (document.getElementById('plan-fact-tab').classList.contains('active')) {
        await this.loadPlanFactData(this.filters);
    } else {
        await this.loadProjectResourcesData();
    }
}

    toggleCustomPeriod() {
    const customPeriod = document.getElementById('custom-period');
    customPeriod.style.display = this.filters.period === 'custom' ? 'flex' : 'none';

    // 🚀 Автоматически обновляем dateFrom и dateTo при смене периода
    if (this.filters.period !== 'custom') {
        const dateRange = this.bitrixService.getDateRange(this.filters.period);
        document.getElementById('date-from').value = dateRange.from;
        document.getElementById('date-to').value = dateRange.to;
        // Обновляем и в фильтрах
        this.filters.dateFrom = dateRange.from;
        this.filters.dateTo = dateRange.to;
    }
}

    async loadPlanFactData(filters = null) {
    try {
        this.showLoading('plan-fact-body');
        
        // Если фильтры не переданы — используем this.filters, иначе — переданные
        const appliedFilters = filters !== null ? filters : this.filters;
        
        const data = await this.bitrixService.getPlanFactData(appliedFilters);
        this.currentData.planFact = data;
        
        console.log('Plan-fact data to render:', data);
        this.renderPlanFactTable(data);
        
    } catch (error) {
        console.error('Error loading plan-fact data:', error);
        this.showError('Ошибка загрузки данных: ' + error.message);
    }
}
    async loadProjectResourcesData() {
        const projectId = document.getElementById('project-filter').value;
        const detailLevel = document.getElementById('detail-level').value;
        
        if (!projectId) {
            this.showInfo('Выберите проект для анализа');
            return;
        }

        try {
            this.showLoading('resources-body');
            
            const data = await this.bitrixService.getProjectResources(
                projectId, 
                parseInt(detailLevel)
            );
            
            this.currentData.projectResources = data;
            console.log('Project resources data to render:', data);
            this.renderProjectResourcesTable(data, parseInt(detailLevel));
            
        } catch (error) {
            console.error('Error loading project resources:', error);
            this.showError('Ошибка загрузки ресурсов: ' + error.message);
        }
    }

    renderPlanFactTable(data) {
        const tbody = document.getElementById('plan-fact-body');
        
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="loading-text">Нет данных для отображения</td></tr>';
            return;
        }

        let html = '';
        let currentProject = '';
        let currentUserName = '';

        data.forEach(item => {
            if (item.projectName !== currentProject) {
                currentProject = item.projectName;
                currentUserName = '';
                html += `<tr class="project-header"><td colspan="6">${item.projectName}</td></tr>`;
            }

            if (item.userName !== currentUserName) {
                currentUserName = item.userName;
                html += `<tr class="user-header"><td colspan="6">${item.userName}</td></tr>`;
            }

            html += `
                <tr class="${item.isSummary ? 'summary-row' : ''}">
                    <td>${item.projectName}</td>
                    <td>${item.userName}</td>
                    <td>${item.taskTitle}</td>
                    <td>${item.actualHours ? item.actualHours.toFixed(1) : '0.0'}</td>
                    <td>${item.plannedHours ? item.plannedHours.toFixed(1) : '0.0'}</td>
                    <td class="${item.actualHours > item.plannedHours ? 'overplan' : 'underplan'}">
                        ${(item.actualHours - item.plannedHours).toFixed(1)}
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    }

    renderProjectResourcesTable(data, detailLevel) {
        const tbody = document.getElementById('resources-body');
        
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="loading-text">Нет данных для отображения</td></tr>';
            return;
        }

        tbody.innerHTML = data.map(item => {
            if (item.isProjectTotal) {
                return `
                    <tr class="project-total">
                        <td colspan="4"><strong>${item.taskTitle}</strong></td>
                        <td><strong>${item.actualHours ? item.actualHours.toFixed(1) : '0.0'}</strong></td>
                        <td><strong>${item.plannedHours ? item.plannedHours.toFixed(1) : '0.0'}</strong></td>
                    </tr>
                `;
            }

            return `
                <tr class="level-${item.level || 0}">
                    <td>${item.projectName || ''}</td>
                    <td>${item.userName || ''}</td>
                    <td>${item.taskTitle || ''}</td>
                    <td>${item.subtaskTitle || ''}</td>
                    <td>${item.actualHours ? item.actualHours.toFixed(1) : '0.0'}</td>
                    <td>${item.plannedHours ? item.plannedHours.toFixed(1) : '0.0'}</td>
                </tr>
            `;
        }).join('');

        // Добавляем стили для уровней вложенности (если еще не добавлены)
        if (!document.querySelector('#dynamic-styles')) {
            const style = document.createElement('style');
            style.id = 'dynamic-styles';
            style.textContent = `
                .project-header { background-color: #e3f2fd; font-weight: bold; border-bottom: 2px solid #1976d2; }
                .user-header { background-color: #f5f5f5; font-weight: bold; border-bottom: 1px solid #ddd; }
                .summary-row { background-color: #fff3e0; font-weight: bold; }
                .overplan { color: #d32f2f; }
                .underplan { color: #388e3c; }
                .project-total { background-color: #4caf50; color: white; }
                .level-0 { background-color: #ffffff; }
                .level-1 { background-color: #f9f9f9; }
                .level-2 { background-color: #f0f0f0; }
                .level-3 { background-color: #e8e8e8; }
            `;
            document.head.appendChild(style);
        }
    }

    switchTab(tabName) {
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        document.getElementById(`${tabName}-tab`).classList.add('active');
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        if (tabName === 'project-resources') {
            this.loadProjectResourcesData();
        } else {
            this.loadPlanFactData();
        }
    }

    async refreshData() {
        this.bitrixService.cache.clear();
        await this.loadInitialData();
        
        if (document.getElementById('plan-fact-tab').classList.contains('active')) {
            await this.loadPlanFactData();
        } else {
            await this.loadProjectResourcesData();
        }
        
        this.showInfo('Данные обновлены');
    }

    exportToExcel(type) {
        this.showInfo('Экспорт в Excel доступен только для просмотра данных');
    }

    showLoader() {
        document.getElementById('loader').style.display = 'flex';
    }

    hideLoader() {
        document.getElementById('loader').style.display = 'none';
    }

    showApp() {
        document.getElementById('app').style.display = 'block';
    }

    showLoading(tbodyId) {
        const tbody = document.getElementById(tbodyId);
        tbody.innerHTML = '<tr><td colspan="6" class="loading-text">Загрузка данных...</td></tr>';
    }

    showError(message) {
        document.getElementById('error-message').textContent = message;
        document.getElementById('error-modal').style.display = 'flex';
    }

    hideError() {
        document.getElementById('error-modal').style.display = 'none';
    }

    showInfo(message) {
        document.getElementById('info-message').textContent = message;
        document.getElementById('info-modal').style.display = 'flex';
    }

    hideInfo() {
        document.getElementById('info-modal').style.display = 'none';
    }
}

IntoGroupBitrixService.prototype.getPlanFactData = async function(filters = {}) {
    try {
        const taskFilter = {};

        // ТОЛЬКО выполненные задачи (статус 5)
        taskFilter['STATUS'] = 5;

        if (filters.projectId) {
            taskFilter.GROUP_ID = filters.projectId;
        }

        // Фильтр по дате завершения (CLOSED_DATE)
        if (filters.period && filters.period !== 'all') {
            const dateRange = this.getDateRange(filters.period, filters.dateFrom, filters.dateTo);
            taskFilter['>CLOSED_DATE'] = dateRange.from + ' 00:00:00';
            taskFilter['<CLOSED_DATE'] = dateRange.to + ' 23:59:59';
        }

        const tasks = await this.getTasks({
            filter: taskFilter,
            select: ['ID', 'TITLE', 'GROUP_ID', 'RESPONSIBLE_ID', 'TIME_ESTIMATE', 'TIME_SPENT_IN_LOGS', 'CLOSED_DATE', 'STATUS']
        });

        console.log('Выполненные задачи для План/Факт:', tasks.length);

        // Получаем информацию о проектах
        const projectIds = [...new Set(tasks.map(task => task.groupId).filter(id => id))];
        const projects = await Promise.all(
            projectIds.map(id => this.getProjects({ filter: { ID: id } }))
        );
        
        const projectMap = new Map();
        projects.flat().forEach(project => {
            projectMap.set(parseInt(project.ID), project);
        });

        // Фильтр пользователей по подразделению
        const userFilter = {};
        if (filters.departmentId) {
            userFilter.UF_DEPARTMENT = filters.departmentId;
        }

        const users = await this.getUsers({
            filter: userFilter,
            select: ['ID', 'NAME', 'LAST_NAME', 'UF_DEPARTMENT']
        });

        return this.processPlanFactData(tasks, users, projectMap);
    } catch (error) {
        console.error('Error in getPlanFactData:', error);
        throw error;
    }
};

IntoGroupBitrixService.prototype.getProjectResources = async function(projectId, detailLevel) {
    try {
        // ВСЕ задачи проекта (любые статусы)
        const tasks = await this.getTasks({ 
            filter: { 
                GROUP_ID: projectId
            } 
        });
        
        console.log('Все задачи проекта (Ресурсы проекта):', tasks.length);

        const projects = await this.getProjects({ filter: { ID: projectId } });
        const project = projects.length > 0 ? projects[0] : { ID: projectId, NAME: `Проект ${projectId}` };
        
        const users = await this.getUsers();

        return this.processProjectResources(tasks, users, project, detailLevel);
    } catch (error) {
        console.error('Error in getProjectResources:', error);
        throw error;
    }
};

IntoGroupBitrixService.prototype.processPlanFactData = function(tasks, users, projectMap) {
    try {
        const userMap = new Map();
        users.forEach(user => {
            userMap.set(parseInt(user.ID), user);
        });

        const result = [];
        const userTaskMap = new Map();

        // Группируем задачи по пользователям и проектам
        tasks.forEach(task => {
            if (!task.groupId || !task.responsibleId) return;

            const projectId = task.groupId;
            const userId = parseInt(task.responsibleId);
            const taskId = task.id;
            
            const user = userMap.get(userId);
            const userName = user ? `${user.NAME || ''} ${user.LAST_NAME || ''}`.trim() : 'Не назначен';
            
            const project = projectMap.get(parseInt(projectId));
            const projectName = project ? project.NAME : `Проект ${projectId}`;

            const key = `${projectId}-${userId}`;
            if (!userTaskMap.has(key)) {
                userTaskMap.set(key, {
                    projectName,
                    userName,
                    tasks: new Map(),
                    totalActual: 0,
                    totalPlanned: 0
                });
            }

            const userData = userTaskMap.get(key);
            if (!userData.tasks.has(taskId)) {
                userData.tasks.set(taskId, {
                    title: task.title || 'Без названия',
                    actualHours: 0,
                    plannedHours: 0
                });
            }

            const taskData = userData.tasks.get(taskId);
            const actualSeconds = task.timeSpentInLogs ? parseInt(task.timeSpentInLogs) : 0;
            const actualHours = actualSeconds / 3600;
            taskData.actualHours += actualHours;
            userData.totalActual += actualHours;

            const plannedSeconds = task.timeEstimate ? parseInt(task.timeEstimate) : 0;
            const plannedHours = plannedSeconds / 3600;
            taskData.plannedHours += plannedHours;
            userData.totalPlanned += plannedHours;
        });

        // Формируем результат
        for (const [key, userData] of userTaskMap) {
            // Добавляем отдельные задачи
            for (const [taskId, taskData] of userData.tasks) {
                result.push({
                    projectName: userData.projectName,
                    userName: userData.userName,
                    taskTitle: taskData.title,
                    actualHours: taskData.actualHours,
                    plannedHours: taskData.plannedHours,
                    isSummary: false
                });
            }

            // Добавляем итоги по пользователю
            result.push({
                projectName: userData.projectName,
                userName: userData.userName,
                taskTitle: 'Сумма по всем задачам',
                actualHours: userData.totalActual,
                plannedHours: userData.totalPlanned,
                isSummary: true
            });
        }

        // Сортируем результат
        result.sort((a, b) => {
            if (a.projectName !== b.projectName) return a.projectName.localeCompare(b.projectName);
            if (a.userName !== b.userName) return a.userName.localeCompare(b.userName);
            if (a.isSummary && !b.isSummary) return 1;
            if (!a.isSummary && b.isSummary) return -1;
            return a.taskTitle.localeCompare(b.taskTitle);
        });

        return result;
    } catch (error) {
        console.error('Error in processPlanFactData:', error);
        return [];
    }
};
IntoGroupBitrixService.prototype.processProjectResources = function(tasks, users, project, detailLevel) {
    try {
        const userMap = new Map();
        users.forEach(user => {
            userMap.set(parseInt(user.ID), user);
        });

        const taskMap = new Map();
        const result = [];
        let projectTotalActual = 0;
        let projectTotalPlanned = 0;

        tasks.forEach(task => {
            const actualHours = (task.timeSpentInLogs && !isNaN(parseInt(task.timeSpentInLogs))) 
                ? parseInt(task.timeSpentInLogs) / 3600 
                : 0;
            const plannedHours = (task.timeEstimate && !isNaN(parseInt(task.timeEstimate))) 
                ? parseInt(task.timeEstimate) / 3600 
                : 0;

            taskMap.set(task.id, {
                ...task,
                children: [],
                actualHours,
                plannedHours,
                level: 0
            });

            projectTotalActual += actualHours;
            projectTotalPlanned += plannedHours;
        });

        const hierarchy = [];
        for (const task of taskMap.values()) {
            if (!task.parentId || !taskMap.has(task.parentId)) {
                hierarchy.push(task);
            } else {
                const parent = taskMap.get(task.parentId);
                if (parent) {
                    parent.children.push(task);
                    task.level = parent.level + 1;
                }
            }
        }

        const flattenHierarchy = (tasks, level) => {
            let flatList = [];
            
            for (const task of tasks) {
                if (level <= detailLevel) {
                    const user = userMap.get(parseInt(task.responsibleId));
                    flatList.push({
                        projectId: task.groupId,
                        projectName: task.group && task.group.name ? task.group.name : `Проект ${task.groupId}`,
                        taskId: task.id,
                        taskTitle: task.title || 'Без названия',
                        subtaskTitle: level > 0 ? `Уровень ${level}` : '',
                        userId: task.responsibleId,
                        userName: user 
                            ? `${user.NAME || ''} ${user.LAST_NAME || ''}`.trim() 
                            : 'Не назначен',
                        actualHours: task.actualHours,
                        plannedHours: task.plannedHours,
                        level: level
                    });
                }

                if (task.children.length > 0 && level < detailLevel) {
                    flatList = flatList.concat(flattenHierarchy(task.children, level + 1));
                }
            }

            return flatList;
        };

        const taskList = flattenHierarchy(hierarchy, 0);

        taskList.push({
            projectName: project.NAME,
            taskTitle: 'ИТОГО ПО ПРОЕКТУ',
            userName: '',
            actualHours: projectTotalActual,
            plannedHours: projectTotalPlanned,
            level: 999,
            isProjectTotal: true
        });

        return taskList.sort((a, b) => {
            if (a.isProjectTotal && !b.isProjectTotal) return 1;
            if (!a.isProjectTotal && b.isProjectTotal) return -1;
            return 0;
        });
    } catch (error) {
        console.error('Error in processProjectResources:', error);
        return [];
    }
};

IntoGroupBitrixService.prototype.getDateRange = function(period = 'month', customFrom = null, customTo = null) {
    const now = new Date();
    let from, to;

    switch (period) {
        case 'week':
            from = new Date(now);
            from.setDate(now.getDate() - 7);
            to = new Date(now);
            break;
        case 'month':
            from = new Date(now.getFullYear(), now.getMonth(), 1);
            to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            break;
        case 'quarter':
            const quarter = Math.floor(now.getMonth() / 3);
            from = new Date(now.getFullYear(), quarter * 3, 1);
            to = new Date(now.getFullYear(), (quarter + 1) * 3, 0);
            break;
        case 'year':
            from = new Date(now.getFullYear(), 0, 1);
            to = new Date(now.getFullYear(), 11, 31);
            break;
        case 'custom':
            from = customFrom ? new Date(customFrom) : new Date(now);
            to = customTo ? new Date(customTo) : new Date(now);
            break;
        default:
            from = new Date(now);
            from.setDate(now.getDate() - 30);
            to = new Date(now);
    }

    const formatDate = (date) => {
        return date.toISOString().split('T')[0];
    };

    return {
        from: formatDate(from),
        to: formatDate(to)
    };
};

document.addEventListener('DOMContentLoaded', function() {
    window.app = new ResourceManagementApp();
    window.app.init();
});

window.hideError = function() {
    document.getElementById('error-modal').style.display = 'none';
};

window.hideInfo = function() {
    document.getElementById('info-modal').style.display = 'none';
};