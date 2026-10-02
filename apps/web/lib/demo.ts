/** Seeded demo accounts that may use one-click sign-in (DEMO_LOGIN_ENABLED=true). Nothing else can. */
export const DEMO_ACCOUNTS: Record<string, string> = {
  owner: "owner@shearbliss.demo",
  staff: "staff@shearbliss.demo",
  tutor: "owner@brightpath.demo",
};

export const demoLoginEnabled = () => process.env.DEMO_LOGIN_ENABLED === "true";
