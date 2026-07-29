export interface GithubApiResponse {
  data: {
    user: {
      contributionsCollection: {
        contributionCalendar: {
          totalContributions: number;
          weeks: {
            contributionDays: {
              contributionCount: number;
              date: string;
            }[];
          }[];
        };
      };
    };
  };
}

export interface DayContribution {
  date: string;
  count: number;
  weekday: number;
  weekIndex: number;
  /**
   * Repo mode only: identity (email) of the day's most active committer, used
   * to tint that day's terrain. Undefined for user-calendar data and empty days.
   */
  topAuthor?: string;
}
