const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue, Filter } = require('firebase-admin/firestore');
const functions = require('firebase-functions');
const axios = require('axios');


initializeApp();
const firestoredb = getFirestore();

async function calculateDistanceUsingAPI(orderLocation, deliveryPartnerLocation) {
    
    try {
        const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
            params: {
                origins: `${orderLocation.latitude},${orderLocation.longitude}`,
                destinations: `${deliveryPartnerLocation.latitude},${deliveryPartnerLocation.longitude}`,

                key: 'AIzaSyAs3PWPbBMyFsNv9R-OKFbEaOO9VAHuB4c'
            }
        });
            if(response.data && response.data.status === 'OK' && response.data.rows && response.data.rows.length > 0){
                return Math.floor(response.data.rows[0].elements[0].distance.value/1000);
            }else {
                console.log("Unsuccessful response from API : ",response.data.status);
                return -1;
            }
            
    } catch (error) {
        console.log("Error in calculateDistanceUsingAPI: ",error)
        return -1;
    }
}
async function fetchOrders() {
    try {
        const ordersData = await firestoredb.collection('orders').get();
        const orders = [];
        
        ordersData.forEach(doc => {
            const data = doc.data();
             const address = data.address;
            if(address.location){
                const geopoint = address.location.geopoint;
                if(geopoint){
                const latitude = geopoint._latitude;
                const longitude = geopoint._longitude;
                orders.push({ id: doc.id, latitude, longitude });
            }else{
                    console.log("Geopoint is undefined for order:", doc.id)
                }
                
            }else{
                console.log("Location data is undefined for order: ",doc.id)
            }
        });
       return orders;
    } catch (error) {
        console.error('Error fetching orders:', error);
        return []; 
    }
}

async function fetchDeliveryPartners() {
    try{
        const deliveryPartnersData = await firestoredb.collection('delivery_partners').get();
        const deliveryPartners = [];
        deliveryPartnersData.forEach(doc => {
        const data = doc.data();
        const locationCoordinates = data.locationCordinates;
        if(locationCoordinates){
            const latitude = locationCoordinates._latitude;
            const longitude = locationCoordinates._longitude;
            deliveryPartners.push({id : doc.id,latitude,longitude});
        }else{
            console.log(" Location data is undefined for DeliveryPartner: ",doc.id)
        }
    })
    return deliveryPartners;
        
    }catch(error){
        console.log('Error delivery orders: ', error);
        return [];
    }
    }

    async function fetchStoreLocation(){
        try{
            const storeData = await firestoredb.collection('stores').get();
            const stores = [];
            storeData.forEach(doc => {
                const data = doc.data();
                const loc = data.storeLocation;
                if(loc){
                    const geopoint = loc.geopoint;
                    if(geopoint){
                        const latitude = geopoint._latitude;
                        const longitude = geopoint._longitude;
                        stores.push({ id: doc.id, latitude, longitude });
                    }else{
                            console.log("Geopoint is undefined for this store:", doc.id)
                        }

                }else{
                    console.log(" Store data is undefined : ",doc.id)
                }
            })
            return stores;
        }catch(err){
        console.log('Error Fetching store location : ', err);
        return [];

        }
    }


    async function findNearestDeliveryPartnerForOrder(order, deliveryPartners, storeLocation) {
        
        try{

        let shortestDistance = 9999;
        let nearestDeliveryPartnerId = '';

        if(deliveryPartners.length > 0 && storeLocation.length > 0){
            for (const deliveryPartner of deliveryPartners) {
              let totalDistance = 0;
        
                const distanceToOrder = await calculateDistanceUsingAPI(deliveryPartner, order);
                totalDistance += distanceToOrder;
        
                for (const store of storeLocation) {
                    const distanceToStore = await calculateDistanceUsingAPI(deliveryPartner, store);

                    totalDistance += distanceToStore;

                }
        
                if (totalDistance < shortestDistance) {
                    shortestDistance = totalDistance;
                    nearestDeliveryPartnerId = deliveryPartner.id;
                }
            }

            return nearestDeliveryPartnerId;
        }else{
            return '';
        }
    }catch(err){
            console.log('Error Fetching store and delivery location : ', err);
            return "";
        }
        
    }

 
exports.findNearestDistanceForOrders = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(400).send("Invalid request");
    }
    try {
        const nearestDistances = [];
        const orders = await fetchOrders();
        let deliveryPartners = await fetchDeliveryPartners();
        const storeLocation = await fetchStoreLocation();
        if(orders.length === 0){
            return res.status(404).send("No Orders are available.");

        }
        if(deliveryPartners.length === 0){
            return res.status(404).send("No Delivery Partners are available.");
        }
        if(storeLocation.length === 0){
            return res.status(404).send("No stores are available.");
        }

        // let availableDeliveryPartner = [...deliveryPartners];

        for (const order of orders) {
            const nearestDelivery = await findNearestDeliveryPartnerForOrder(order, deliveryPartners, storeLocation);
            if (nearestDelivery !== '') {
                nearestDistances.push({ OrderId: order.id, NearestDeliveryPartnerId: nearestDelivery});
                deliveryPartners = deliveryPartners.filter(obj => obj.id !== nearestDelivery);

                await allocateDeliveryPartnerToOrder(order.id, nearestDelivery);
            } else {
                console.log("No Delivery partners are available to deliver this order:", order.id);
            }
        }
        return res.status(200).json(nearestDistances);
} catch (error) {
        console.error('Error in find distance :', error);
        return res.status(500).send('Internal Server Error');
    }
});

async function allocateDeliveryPartnerToOrder(orderId,nearestDeliveryPartnerId){
    try{
        await firestoredb.collection('orders').doc(orderId).update({
            deliveryPartnerId:nearestDeliveryPartnerId
        })
        console.log(`Delivery partner ${nearestDeliveryPartnerId} allocated to order ${orderId}`);

    }catch(err){
        console.error("Error in allocateDeliveryPartnerToOrder:", err);
    }
}
