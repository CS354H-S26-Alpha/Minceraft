import m0000 from "./0000_fast_rocket_racer.sql";
import m0001 from "./0001_ancient_morlun.sql";
import m0002 from "./0002_steady_tigra.sql";
import m0003 from "./0003_sudden_inventory.sql";
import m0004 from "./0004_steady_health.sql";
import journal from "./meta/_journal.json";

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
    m0003,
    m0004,
  },
};
