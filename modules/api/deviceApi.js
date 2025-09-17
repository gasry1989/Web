import { httpPost } from '@core/http.js';
import { apiPath } from '@core/apiCatalog.js';

/**
 * 3.10 获取设备列表（按用户）
 * payload:
 *  {
 *    userIds?: number[]    // 为空或不传：当前用户及所有后代；有值：这些用户及其所有后代
 *    pageIndex: number
 *    pageSize: number
 *  }
 */
export function apiDeviceList(options = {}) {
  const {
    userIds = [],
    pageIndex = 1,
    pageSize = 10
  } = options;

  const payload = {
    pageIndex,
    pageSize
  };
  if (Array.isArray(userIds) && userIds.length) {
    payload.userIds = userIds;
  }
  return httpPost(apiPath('3.10'), payload);
}

/**
 * 3.20 汇总 (其它页面仍可能用到)
 */
export function apiDeviceSummary(pageIndex = 1, pageSize = 10) {
  return httpPost(apiPath('3.20'), { pageIndex, pageSize });
}

/* 其余接口保持原有 */
export function apiDevTypes() {
  return httpPost(apiPath('3.13'), {});
}
export function apiDevModes() {
  return httpPost(apiPath('3.14'), {});
}
export function apiGroupedDevices(filters) {
  const { devType, devMode, searchStr, filterOnline } = filters;
  return httpPost(apiPath('3.15'), {
    devType: devType || 0,
    devMode: devMode || 0,
    filterStr: searchStr || '',
    filterOnline: !!filterOnline
  });
}
export function apiUngroupedDevices(filters) {
  const { devType, devMode, searchStr, filterOnline } = filters;
  return httpPost(apiPath('3.16'), {
    devType: devType || 0,
    devMode: devMode || 0,
    filterStr: searchStr || '',
    filterOnline: !!filterOnline
  });
}
export function apiDeviceInfo(devId) {
  return httpPost(apiPath('3.17'), { devId });
}
export function apiOnlineList() {
  return httpPost(apiPath('3.21'), {});
}
/**
 * 3.18 修改设备信息/设备属主
 * POST /api/web/dev/update_info
 * 请求体：{ devInfo: { id, name?, type?, modeList?, parentUserId? } }
 */
export function apiDeviceUpdateInfo(devInfo) {
  return httpPost(apiPath('3.18'), { devInfo });
}