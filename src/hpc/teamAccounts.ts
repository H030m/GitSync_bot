// 隊友的姓名 / HPC 主機帳號 / Discord 帳號對照表（種子資料）。
// 公開 repo 版本刻意留空：真實名單屬於個資，不納入版本控制。
// 這份清單只在 store/teamMembers.ts 第一次讀取、資料庫還是空的時候拿來當種子資料；
// 之後要新增隊友請用 `/quota-add-member` 指令，不用改這個檔案。
// 本機要預先塞名單的話，照下面的格式填進 SEED_TEAM_MEMBERS（不要 commit）。
export interface SeedTeamMember {
  name: string;
  hpcAccount: string;
  discordUsername: string;
}

export const SEED_TEAM_MEMBERS: SeedTeamMember[] = [
  // { name: "小明", hpcAccount: "u1234567", discordUsername: "some_username" },
];
