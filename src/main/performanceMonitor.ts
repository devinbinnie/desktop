// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

const METRIC_UPDATE_INTERVAL = 1000;

export class PerformanceMonitor {
    private updateInterval?: NodeJS.Timeout;
    private rendererProcesses: Map<number, {name: string}>;

    constructor() {
        this.rendererProcesses = new Map();
    }

    start = () => {
        this.updateInterval = setInterval(this.runMetrics, METRIC_UPDATE_INTERVAL);
    };

    stop = () => {
        clearInterval(this.updateInterval);
    };

    registerRendererProcess = (pid: number, name: string) => {
        this.rendererProcesses.set(pid, {name});
    };

    unregisterRendererProcess = (pid: number) => {
        this.rendererProcesses.delete(pid);
    };

    private runMetrics = () => {
        
    };
}

const performanceMonitor = new PerformanceMonitor();
export default performanceMonitor;
