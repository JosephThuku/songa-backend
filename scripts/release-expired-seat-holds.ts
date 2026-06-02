import { releaseAllExpiredSeatHolds } from "../src/services/shared-rides/expired-seat-holds.service.js";

const { released } = await releaseAllExpiredSeatHolds();
console.log(`Released ${released} expired shared departure seat hold(s).`);
