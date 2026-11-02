import { Router, type IRouter } from "express";
import healthRouter from "./health";
import courseMediaRouter from "./course-media";
import chatMediaRouter from "./chat-media";

const router: IRouter = Router();

router.use(healthRouter);
router.use(courseMediaRouter);
router.use(chatMediaRouter);

export default router;
