export interface WatermelonChanges {
  [tableName: string]: {
    created: any[];
    updated: any[];
    deleted: string[];
  };
}

export interface PullResponse {
  changes: WatermelonChanges;
  timestamp: number;
}

export interface PushRequest {
  changes: WatermelonChanges;
}
