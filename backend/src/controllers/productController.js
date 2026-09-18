import Product from "../models/Product.js";
import Category from "../models/Category.js";
import { generateUniqueBarcode } from "../services/barcodeService.js";
import { createNotification } from "./notificationController.js";
import { sendCriticalStockAlert, sendOutOfStockAlert } from "../services/emailService.js";
import Settings from "../models/Settings.js";

const normalizeImages = (images) => {
  if (!images) return [];
  if (Array.isArray(images)) {
    return images.filter(Boolean).map((url) => url.trim());
  }
  return [images].filter(Boolean).map((url) => url.trim());
};

export const updateProduct = async (req, res, next) => {
  try {
    const {
      name,
      description,
      price,
      originalPrice,
      images,
      category,
      subcategory,
      sizes,
      colors,
      stock,
      brand,
      proveedor,
      importe,
      taxes,
      impuestosImportacion,
      flete,
      costo,
      paraTienda,
      location,
      barcode,
      generateBarcode: autoBarcode,
      variants, // New: array of variants to update
      hasVariants, // New: flag to indicate if product uses variants
    } = req.body;

    const updates = {
      name: name?.trim(),
      description,
      price,
      originalPrice,
      subcategory,
      sizes,
      colors,
      stock,
      brand,
      proveedor,
      importe,
      taxes,
      impuestosImportacion,
      flete,
      costo,
      paraTienda,
      location,
    };

    // Update stockZeroAt logic
    if (stock !== undefined) {
      if (stock === 0) {
        updates.stockZeroAt = new Date();
      } else if (stock > 0) {
        updates.stockZeroAt = null;
      }
    }

    // Handle variants update
    if (variants !== undefined) {
      updates.variants = variants.map((v) => ({
        size: v.size || null,
        color: v.color || null,
        stock: v.stock || 0,
        sku: v.sku || null,
        stockZeroAt: v.stock === 0 ? new Date() : null,
        images: v.images || [], // Include images
        _id: v._id, // Preserve existing variant ID if updating
      }));

      // Extract unique sizes and colors from variants
      const uniqueSizes = [...new Set(variants.map((v) => v.size).filter(Boolean))];
      const uniqueColors = [...new Set(variants.map((v) => v.color).filter(Boolean))];

      if (uniqueSizes.length > 0) updates.sizes = uniqueSizes;
      if (uniqueColors.length > 0) updates.colors = uniqueColors;
    }

    if (hasVariants !== undefined) {
      updates.hasVariants = hasVariants;
    }

    if (category) {
      const categoryData = await Category.findById(category);
      if (!categoryData) {
        res.status(400);
        throw new Error("Categoría inválida");
      }
      updates.category = categoryData._id;
      updates.categorySlug = categoryData.slug;
    }

    if (typeof barcode === "string" && barcode.trim()) {
      updates.barcode = barcode.trim().toUpperCase();
    }

    if (autoBarcode) {
      updates.barcode = await generateUniqueBarcode();
    }

    if (images !== undefined) {
      updates.images = normalizeImages(images);
    }

    Object.keys(updates).forEach((key) => {
      if (updates[key] === undefined) delete updates[key];
    });

    const product = await Product.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).populate('category');

    if (!product) {
      res.status(404);
      throw new Error("Producto no encontrado");
    }

    // Check for low stock notification
    if (product.stock <= 5) {
      await createNotification({
        type: 'low_stock',
        message: `Stock bajo para producto: ${product.name} (${product.stock} unidades)`,
        metadata: { productId: product._id }
      });
    }

    // Check for critical stock and send email
    try {
      const criticalStockSetting = await Settings.findOne({ key: 'fashion_inventory_critical_stock' });
      const criticalStockLevel = criticalStockSetting?.value ? parseInt(criticalStockSetting.value) : 5;

      if (product.stock === 0) {
        // Send out-of-stock alert
        await sendOutOfStockAlert(product);
      } else if (product.stock > 0 && product.stock <= criticalStockLevel) {
        // Send critical stock alert
        await sendCriticalStockAlert(product, criticalStockLevel);
      }
    } catch (emailError) {
      console.error('Error sending stock email:', emailError);
      // Don't fail the request if email fails
    }

    res.json(product);
  } catch (error) {
    if (error.code === 11000) {
      res.status(409);
      if (error.keyPattern.barcode) {
        error.message = "El código de barra ya está registrado";
      }
    }
    next(error);
  }
};

export const createProduct = async (req, res, next) => {
  try {
    const {
      name,
      description,
      price,
      originalPrice,
      images,
      category, // expect ID
      subcategory,
      sizes,
      colors,
      stock,
      brand,
      proveedor,
      importe,
      taxes,
      impuestosImportacion,
      flete,
      costo,
      paraTienda,
      location,
      barcode,
      variants, // New: array of variants
      hasVariants, // New: flag to indicate if product uses variants
    } = req.body;

    if (!name?.trim()) {
      res.status(400);
      throw new Error("El nombre del producto es obligatorio");
    }

    // Validate Category
    let categoryData = null;
    if (category) {
      categoryData = await Category.findById(category);
      if (!categoryData) {
        res.status(400);
        throw new Error("Categoría inválida");
      }
    } else {
      res.status(400);
      throw new Error("La categoría es obligatoria");
    }

    let finalBarcode = barcode?.toString().trim().toUpperCase();
    if (!finalBarcode) {
      finalBarcode = await generateUniqueBarcode();
    }

    // Prepare variants array
    let productVariants = [];
    let productHasVariants = false;
    let extractedSizes = sizes || [];
    let extractedColors = colors || [];

    if (variants && Array.isArray(variants) && variants.length > 0) {
      // Product has explicit variants
      productHasVariants = true;
      productVariants = variants.map((v) => ({
        size: v.size || null,
        color: v.color || null,
        stock: v.stock || 0,
        sku: v.sku || null,
        images: v.images || [], // Include images
        stockZeroAt: v.stock === 0 ? new Date() : null,
      }));

      // Extract unique sizes and colors from variants
      const uniqueSizes = [...new Set(variants.map((v) => v.size).filter(Boolean))];
      const uniqueColors = [...new Set(variants.map((v) => v.color).filter(Boolean))];

      if (uniqueSizes.length > 0) extractedSizes = uniqueSizes;
      if (uniqueColors.length > 0) extractedColors = uniqueColors;
    } else {
      // No variants provided, create single default variant with stock
      productHasVariants = false;
      productVariants = [
        {
          size: null,
          color: null,
          stock: stock || 0,
          sku: finalBarcode,
          stockZeroAt: stock === 0 ? new Date() : null,
        },
      ];
    }

    const product = await Product.create({
      name: name.trim(),
      description,
      price,
      originalPrice,
      images: normalizeImages(images),
      category: categoryData._id,
      categorySlug: categoryData.slug,
      subcategory,
      sizes: extractedSizes,
      colors: extractedColors,
      stock: stock || 0, // Keep for backward compatibility
      hasVariants: productHasVariants,
      variants: productVariants,
      brand,
      proveedor,
      importe,
      taxes,
      impuestosImportacion,
      flete,
      costo,
      paraTienda,
      location,
      barcode: finalBarcode,
      stockZeroAt: stock === 0 ? new Date() : null,
    });

    res.status(product).json(product);
  } catch (error) {
    if (error.code === 11000) {
      res.status(409);
      if (error.keyPattern.barcode) {
        error.message = "El código de barra ya está registrado";
      }
    }
    next(error);
  }
};

export const getAllProducts = async (req, res) => {
  try {
    const {
      category,
      categoryName,
      subcategory,
      item,
      search,
      minPrice,
      maxPrice,
      featured,
      onSale,
      sort,
      page = 1,
      limit = 20,
      visibleInStore,
    } = req.query;

    const query = {};

    // Handle category filtering - support both ObjectId and name
    if (category) {
      // If it's a valid ObjectId, use it directly
      if (mongoose.Types.ObjectId.isValid(category)) {
        query.category = category;
      } else {
        // Otherwise, find category by name and use its ID
        const categoryDoc = await Category.findOne({
          $or: [
            { name: { $regex: new RegExp(`^${category}$`, 'i') } },
            { slug: category.toLowerCase() }
          ]
        });
        if (categoryDoc) {
          query.category = categoryDoc._id;
        } else {
          // If category not found, return empty results
          return res.json({
            products: [],
            currentPage: Number(page),
            totalPages: 0,
            totalProducts: 0,
          });
        }
      }
    }

    // Handle visibleInStore filtering
    if (visibleInStore === 'true') {
      query.paraTienda = true;
    }

    // Handle category filtering by name (from frontend)
    if (categoryName) {
      // Map frontend category names to backend category names
      const categoryNameMap = {
        'Hombres': 'Hombres',
        'Mujeres': 'Mujeres',
        'Belleza': 'Belleza',
        'Joyeria': 'Joyeria',
        'Varios': 'Varios',
      };
      const mappedCategoryName = categoryNameMap[categoryName] || categoryName;

      const categoryDoc = await Category.findOne({
        name: { $regex: new RegExp(`^${mappedCategoryName}$`, 'i') }
      });
      if (categoryDoc) {
        query.category = categoryDoc._id;
      } else {
        // If category not found, return empty results
        return res.json({
          products: [],
          currentPage: Number(page),
          totalPages: 0,
          totalProducts: 0,
        });
      }
    }

    if (subcategory) {
      query.subcategory = { $regex: new RegExp(subcategory, 'i') };
    }

    if (item) {
      // Search for item in product name or description
      query.$or = [
        { name: { $regex: new RegExp(item, 'i') } },
        { description: { $regex: new RegExp(item, 'i') } },
      ];
      // If there's already a $or from search, combine them
      if (search) {
        query.$or = [
          ...query.$or,
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { brand: { $regex: search, $options: 'i' } },
        ];
      }
    } else if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } },
      ];
    }

    if (featured === 'true') query.featured = true;
    if (onSale === 'true') query.onSale = true;
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    const sortOptions = {};
    if (sort === 'price-asc') sortOptions.price = 1;
    else if (sort === 'price-desc') sortOptions.price = -1;
    else if (sort === 'rating') sortOptions.rating = -1;
    else sortOptions.createdAt = -1;

    const skip = (Number(page) - 1) * Number(limit);

    const products = await Product.find(query)
      .populate('category', 'name slug')
      .sort(sortOptions)
      .skip(skip)
      .limit(Number(limit));

    const total = await Product.countDocuments(query);

    res.json({
      products,
      currentPage: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      totalProducts: total,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};



export const getProducts = async (req, res, next) => {
  try {
    const { search } = req.query;
    const filter = {};

    if (search?.trim()) {
      const searchTerm = search.trim();
      filter.$or = [
        { name: { $regex: searchTerm, $options: "i" } },
        { barcode: { $regex: searchTerm, $options: "i" } },
        { description: { $regex: searchTerm, $options: "i" } },
      ];
    }

    const products = await Product.find(filter)
      .populate('category', 'name slug')
      .sort("-updatedAt");
    res.json(products);
  } catch (error) {
    if (error.name === "MongoError" && error.code === 17007) {
      // Fallback logic if text index fails (though we are using regex mostly here)
      return next(error);
    }
    next(error);
  }
};

export const getProductById = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id).populate('category');
    if (!product) {
      res.status(404);
      throw new Error("Producto no encontrado");
    }
    res.json(product);
  } catch (error) {
    next(error);
  }
};


export const deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      res.status(404);
      throw new Error("Producto no encontrado");
    }

    await product.deleteOne();
    res.json({ message: "Producto eliminado" });
  } catch (error) {
    next(error);
  }
};

export const deleteProductByBarcode = async (req, res, next) => {
  try {
    const product = await Product.findOne({ barcode: req.params.barcode });

    if (!product) {
      res.status(404);
      throw new Error("Producto no encontrado");
    }

    await product.deleteOne();

    res.json({ message: "Producto eliminado por barcode" });
  } catch (error) {
    next(error);
  }
};

export const updateProductByBarcode = async (req, res, next) => {
  // This might need substantial updates if used, but sticking to ID update is safer for full edits.
  // For now, I will update it to match similar logic or keep it minimal if only used for quick updates.
  // Given the complexity of new fields, it's better to reuse updateProduct logic or deprecate this if not strictly needed for quick scanner updates.
  // I'll update it to minimally support critical fields that might change via scanner.
  try {
    const { name, stock, price, location, barcode, images, description } =
      req.body;

    const product = await Product.findOne({ barcode: req.params.barcode });

    if (!product) {
      res.status(404);
      throw new Error("Producto no encontrado");
    }

    const updates = {
      name: name?.trim(),
      stock, // map quantity to stock? The user request changed quantity to stock.
      price,
      location,
      description,
    };

    Object.keys(updates).forEach((key) => {
      if (updates[key] === undefined) delete updates[key];
    });

    Object.assign(product, updates);
    await product.save();

    res.json(product);
  } catch (error) {
    next(error);
  }
};

// Update stock for a specific variant
export const updateVariantStock = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { variantId, size, color, stockChange, newStock } = req.body;

    const product = await Product.findById(productId);
    if (!product) {
      res.status(404);
      throw new Error("Producto no encontrado");
    }

    if (!product.hasVariants || !product.variants || product.variants.length === 0) {
      res.status(400);
      throw new Error("Este producto no tiene variantes");
    }

    // Find the variant to update
    let variantIndex = -1;
    if (variantId) {
      // Find by variant ID
      variantIndex = product.variants.findIndex(
        (v) => v._id.toString() === variantId
      );
    } else if (size !== undefined || color !== undefined) {
      // Find by size/color combination
      variantIndex = product.variants.findIndex((v) => {
        const sizeMatch = size !== undefined ? v.size === size : true;
        const colorMatch = color !== undefined ? v.color === color : true;
        return sizeMatch && colorMatch;
      });
    }

    if (variantIndex === -1) {
      res.status(404);
      throw new Error("Variante no encontrada");
    }

    // Update the stock
    if (newStock !== undefined) {
      product.variants[variantIndex].stock = Math.max(0, newStock);
    } else if (stockChange !== undefined) {
      product.variants[variantIndex].stock = Math.max(
        0,
        product.variants[variantIndex].stock + stockChange
      );
    }

    // Update stockZeroAt
    if (product.variants[variantIndex].stock === 0) {
      product.variants[variantIndex].stockZeroAt = new Date();
    } else {
      product.variants[variantIndex].stockZeroAt = null;
    }

    await product.save();

    // Check for low stock notification based on variant stock
    const variantStock = product.variants[variantIndex].stock;
    if (variantStock <= 5 && variantStock > 0) {
      const variantDesc = [
        product.variants[variantIndex].size,
        product.variants[variantIndex].color,
      ]
        .filter(Boolean)
        .join(" - ");
      await createNotifications({
        type: "low_stock",
        message: `Stock bajo para ${product.name}${variantDesc ? ` (${variantDesc})` : ""}: ${variantStock} unidades`,
        metadata: { productId: product._id, variantId: product.variants[variantIndex]._id },
      });
    }

    // Send email alerts for critical stock
    try {
      const criticalStockSetting = await Settings.findOne({
        key: "fashion_inventory_critical_stock",
      });
      const criticalStockLevel = criticalStockSetting?.value
        ? parseInt(criticalStockSetting.value)
        : 5;

      if (variantStock === 0) {
        await sendOutOfStockAlert(product);
      } else if (variantStock > 0 && variantStock <= criticalStockLevel) {
        await sendCriticalStockAlert(product, criticalStockLevel);
      }
    } catch (emailError) {
      console.error("Error sending stock email:", emailError);
    }

    res.json(product);
  } catch (error) {
    next(error);
  }
};

