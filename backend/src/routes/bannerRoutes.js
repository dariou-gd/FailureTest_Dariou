import express from 'express';
import {
    getBanners,
    createBanner,
    updateBanner,
    deleteBanner,
    reorderBanners
} from '../controllers/bannerController.js';
import { protect, admin } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.route('/')
    .get(getBanners)
    .post(protect, admin, createBanner);

router.route('/reorder')
    .put(protect, admin, reorderBanners);

router.route('/:id')
    .put(protect, admin, updateBanner)
    .delete(protect, admin, deleteBanner);

export default router;
