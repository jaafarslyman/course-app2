import { Router, type IRouter } from "express";
import healthRouter from "./health";
import courseMediaRouter from "./course-media";

const router: IRouter = Router();

router.use(healthRouter);
router.use(courseMediaRouter);

export default router;
