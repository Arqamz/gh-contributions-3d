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
}
