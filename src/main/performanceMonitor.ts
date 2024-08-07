// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {app, ipcMain} from 'electron';
import type {IpcMainEvent, WebContents} from 'electron';

import {METRICS_UPDATE} from 'common/communication';
import {Logger} from 'common/log';

const METRIC_UPDATE_INTERVAL = 5000;
const log = new Logger('PerformanceMonitor');

type Metrics = {
    name: string;
    webContents?: WebContents;
    cpu?: number;
    memory?: number;
}

export class PerformanceMonitor {
    private updateInterval?: NodeJS.Timeout;
    private views: Map<number, Metrics>;

    constructor() {
        this.views = new Map();

        ipcMain.on(METRICS_UPDATE, this.handleMetricsUpdate);
    }

    start = () => {
        this.updateInterval = setInterval(this.runMetrics, METRIC_UPDATE_INTERVAL);
    };

    stop = () => {
        clearInterval(this.updateInterval);
    };

    registerView = (webContentsId: number, name: string, webContents?: WebContents) => {
        this.views.set(webContentsId, {name, webContents});
    };

    unregisterView = (webContentsId: number) => {
        this.views.delete(webContentsId);
    };

    private runMetrics = () => {
        const nodeMetrics = app.getAppMetrics().
            filter((metric) => metric.type !== 'Tab').
            map((metric) => this.getMetricsFromProcessMetric(metric));

        const serverMetrics = [...this.views.values()].filter((metric) => metric.webContents);
        for (const metric of serverMetrics) {
            log.info(`[${metric.name}]`, {cpu: metric.cpu, memory: metric.memory});
        }

        const internalMetrics = [...nodeMetrics, ...[...this.views.values()].filter((metric) => !metric.webContents)];
        log.info('[internalMetrics]', internalMetrics);
    };

    private getMetricsFromProcessMetric = (metric: Electron.ProcessMetric) => {
        return {
            name: metric.name ?? metric.type,
            cpu: metric.cpu.percentCPUUsage,
            memory: metric.memory.workingSetSize,
        };
    };

    private handleMetricsUpdate = (
        event: IpcMainEvent,
        data: {cpu: Electron.CPUUsage; memory: Electron.ProcessMemoryInfo},
    ) => {
        const view = this.views.get(event.sender.id);
        if (!view) {
            return;
        }

        this.views.set(event.sender.id, {
            ...view,
            cpu: data.cpu.percentCPUUsage,
            memory: data.memory.private,
        });
    };
}

const performanceMonitor = new PerformanceMonitor();
export default performanceMonitor;
