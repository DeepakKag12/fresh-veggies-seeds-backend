const axios = require('axios');

/**
 * DTDC API Integration Service
 * 
 * To use DTDC API, you need:
 * 1. DTDC Customer ID
 * 2. API Key from DTDC
 * 3. Register at: https://www.dtdc.in/
 * 
 * Set these in your .env file:
 * DTDC_API_KEY=your_api_key
 * DTDC_CUSTOMER_ID=your_customer_id
 * DTDC_API_URL=https://api.dtdc.com/api (or their actual API endpoint)
 */

class DTDCService {
  constructor() {
    this.apiKey = process.env.DTDC_API_KEY;
    this.customerId = process.env.DTDC_CUSTOMER_ID;
    this.apiUrl = process.env.DTDC_API_URL || 'https://api.dtdc.com/api';
    this.pickupAddress = {
      name: process.env.DTDC_PICKUP_NAME || 'Fresh Veggies Seeds',
      phone: process.env.DTDC_PICKUP_PHONE,
      address: process.env.DTDC_PICKUP_ADDRESS,
      city: process.env.DTDC_PICKUP_CITY,
      state: process.env.DTDC_PICKUP_STATE,
      pincode: process.env.DTDC_PICKUP_PINCODE
    };
  }

  /**
   * Create a shipment with DTDC
   */
  async createShipment(orderData) {
    try {
      if (!this.apiKey || !this.customerId) {
        throw new Error('DTDC credentials not configured. Please set DTDC_API_KEY and DTDC_CUSTOMER_ID in environment variables.');
      }

      const shipmentData = {
        customer_code: this.customerId,
        service_type_id: 'B2C SMART EXPRESS', // or 'B2C EXPRESS', 'B2C PRIORITY'
        load_type: 'NON-DOCUMENT',
        consignment_type: 'Forward',
        dimension_unit: 'cm',
        weight_unit: 'kg',
        
        // Consignee (Customer) Details
        consignee: {
          name: orderData.shippingAddress.name,
          phone: orderData.shippingAddress.phone,
          address: orderData.shippingAddress.street,
          city: orderData.shippingAddress.city,
          state: orderData.shippingAddress.state,
          pincode: orderData.shippingAddress.pincode,
          country: orderData.shippingAddress.country || 'India'
        },

        // Consignor (Your) Details
        consignor: {
          name: this.pickupAddress.name,
          phone: this.pickupAddress.phone,
          address: this.pickupAddress.address,
          city: this.pickupAddress.city,
          state: this.pickupAddress.state,
          pincode: this.pickupAddress.pincode,
          country: 'India'
        },

        // Package Details
        pieces: orderData.orderItems.map((item, index) => ({
          description: item.name,
          declared_value: item.price * item.quantity,
          weight: 0.5, // Default 500g, adjust based on your product
          length: 20,
          breadth: 15,
          height: 10
        })),

        // Order Details
        reference_number: orderData._id.toString(),
        invoice_number: `INV-${orderData._id}`,
        invoice_date: new Date().toISOString().split('T')[0],
        invoice_value: orderData.totalAmount,
        cod_amount: orderData.paymentMode === 'COD' ? orderData.totalAmount : 0,
        
        // Additional Details
        commodity: 'Seeds and Agricultural Products',
        num_pieces: orderData.orderItems.reduce((sum, item) => sum + item.quantity, 0),
        return_address: this.pickupAddress
      };

      const response = await axios.post(
        `${this.apiUrl}/consignment/create`,
        shipmentData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Api-Key': this.apiKey,
            'Customer-Code': this.customerId
          }
        }
      );

      if (response.data.success) {
        return {
          success: true,
          awbNumber: response.data.awb_number,
          trackingUrl: `https://www.dtdc.in/tracking.asp?strCnno=${response.data.awb_number}`,
          courierName: 'DTDC',
          estimatedDelivery: response.data.estimated_delivery_date,
          data: response.data
        };
      } else {
        throw new Error(response.data.error || 'Failed to create shipment');
      }

    } catch (error) {
      console.error('DTDC Shipment Creation Error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error || error.message
      };
    }
  }

  /**
   * Track a shipment using AWB number
   */
  async trackShipment(awbNumber) {
    try {
      if (!this.apiKey) {
        throw new Error('DTDC API credentials not configured');
      }

      const response = await axios.get(
        `${this.apiUrl}/consignment/track`,
        {
          params: {
            awb_number: awbNumber
          },
          headers: {
            'Api-Key': this.apiKey
          }
        }
      );

      if (response.data.success) {
        return {
          success: true,
          status: response.data.status,
          location: response.data.current_location,
          statusHistory: response.data.tracking_history || [],
          estimatedDelivery: response.data.estimated_delivery,
          data: response.data
        };
      } else {
        throw new Error('Unable to track shipment');
      }

    } catch (error) {
      console.error('DTDC Tracking Error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error || error.message
      };
    }
  }

  /**
   * Cancel a shipment
   */
  async cancelShipment(awbNumber) {
    try {
      if (!this.apiKey || !this.customerId) {
        throw new Error('DTDC credentials not configured');
      }

      const response = await axios.post(
        `${this.apiUrl}/consignment/cancel`,
        {
          customer_code: this.customerId,
          awb_number: awbNumber
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Api-Key': this.apiKey
          }
        }
      );

      return {
        success: response.data.success,
        message: response.data.message
      };

    } catch (error) {
      console.error('DTDC Cancellation Error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error || error.message
      };
    }
  }

  /**
   * Get pincode serviceability
   */
  async checkPincodeServiceability(pincode) {
    try {
      const response = await axios.get(
        `${this.apiUrl}/pincode/serviceability`,
        {
          params: {
            pincode: pincode
          },
          headers: {
            'Api-Key': this.apiKey
          }
        }
      );

      return {
        success: true,
        serviceable: response.data.serviceable,
        estimatedDays: response.data.estimated_days,
        services: response.data.available_services || []
      };

    } catch (error) {
      console.error('DTDC Serviceability Check Error:', error.message);
      return {
        success: false,
        serviceable: false,
        error: error.message
      };
    }
  }
}

module.exports = new DTDCService();
