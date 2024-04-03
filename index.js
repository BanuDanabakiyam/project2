const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue, Filter } = require('firebase-admin/firestore');
const functions = require('firebase-functions');
const axios = require('axios');
const { exec } = require('child_process');


initializeApp({
    credential: applicationDefault()
  });
  
const firestoredb = getFirestore();



async function calculateDistanceUsingAPI(orderLocation, deliveryPartnerLocation) {
    try {
        const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
            params: {
                origins: `${orderLocation.latitude},${orderLocation.longitude}`,
                destinations: `${deliveryPartnerLocation.latitude},${deliveryPartnerLocation.longitude}`,
                key: 'AIzaSyDLBZF4wQG1sBz20iAYxwTMFVwQEMcuy3Y'
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
        const ordersData = await firestoredb.collection('orders').where('deliveryPartnerId', '==', '').get();
        const orders = [];
        ordersData.forEach(doc => {
            const data = doc.data();
            const docId = doc.id;
            const address = data.address;
            const orderId = data.orderID;
            const orderStatus = data.orderStatus;
            console.log("Order Status ====",orderStatus);
            if (address.location && !['Cancelled', 'Delivered'].includes(orderStatus)) {
                const geopoint = address.location.geopoint;
                if (geopoint) {
                    const latitude = geopoint._latitude;
                    const longitude = geopoint._longitude;
                    orders.push({ id: orderId, docId: docId, latitude, longitude });
                }
                else {
                    // console.log("Geopoint is undefined for order:", doc.id)
                }
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
            // console.log(" Location data is undefined for DeliveryPartner: ",doc.id)
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
                            // console.log("Geopoint is undefined for this store:", doc.id)
                        }

                }else{
                    // console.log(" Store data is undefined : ",doc.id)
                }
            })
            return stores;
        }catch(err){
        console.log('Error Fetching store location : ', err);
        return [];

        }
    }


async function findNearestDeliveryPartnerForOrderAndStore(order, deliveryPartners, storeLocation) {
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
            return {nearestDeliveryPartnerId: nearestDeliveryPartnerId ,shortestDistance: shortestDistance


            };
        }else{
            return '';
        }
    }catch(err){
            // console.log('Error Fetching store and delivery location : ', err);
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
            
            if (orders.length === 0) {
                return res.status(404).send("No Orders are available.");
            }
            if (deliveryPartners.length === 0) {
                return res.status(404).send("No Delivery Partners are available.");
            }
            if (storeLocation.length === 0) {
                return res.status(404).send("No stores are available.");
            }
            
            const promises = orders.slice(0, 1).map(async (order) => {
                const { nearestDeliveryPartnerId, shortestDistance } = await findNearestDeliveryPartnerForOrderAndStore(order, deliveryPartners, storeLocation);
                if (nearestDeliveryPartnerId) {
                    nearestDistances.push({ OrderId: order.id, NearestDeliveryPartnerId: nearestDeliveryPartnerId, DistanceInKM: shortestDistance });
                    const deliveryPartner = nearestDeliveryPartnerId;
                    console.log("deliveryPartner ====> ", deliveryPartner);
                } else {
                    // console.log("No Delivery partners are available to deliver this order:", order.id);
                }
            });
            
            await Promise.all(promises);
            
            console.log("nearestDistances ", nearestDistances);
            return res.status(200).send(nearestDistances);
        } catch (error) {
            console.log("Error : ", error);
            return res.status(500).send('Internal Server Error');
        }
    });
    

// *********************************************************************************************

// async function fetchOrders() {
//     try {
//         const dataSend = [];

//         const ordersData = await firestoredb.collection('orders').get();
//         ordersData.forEach(doc => {
//             const docId = doc.id;
//             dataSend.push({ orderId: docId });
//         });
//         return dataSend;
//     } catch (error) {
//         console.error('Error fetching orders:', error);
//         throw error; // Rethrow the error to handle it elsewhere if needed
//     }
// }

// async function allocateDeliveryPartnerToOrder(orderID) {
//     console.log("Order=====", orderID);
//     try {
//         await firestoredb.collection('orders').doc(orderID).update({
//             deliveryPartnerId: ''
//         });
//     } catch (err) {
//         console.error("Error:", err);
//         throw err; // Rethrow the error to handle it elsewhere if needed
//     }
// }

// exports.getDeliver = functions.https.onRequest(async(req, res) => {
//     try {
//         const orders = await fetchOrders();
//         const orderIds = orders.map(order => order.orderId); // Extracting order IDs
//         await Promise.all(orderIds.map(orderId => allocateDeliveryPartnerToOrder(orderId)));
//         res.send("Successfully Updated");
//     } catch (err) {
//         console.log("Error", err);
//         res.status(500).send("Error occurred");
//     }
// });



// // const deployFunction = true;
// // if (deployFunction) {
// //     const functionName = 'findNearestDistanceForOrders';
// //     const timeoutDuration = '540s'; 

// //     const command = `gcloud functions deploy ${functionName} --timeout=${timeoutDuration}`;

// //     exec(command, (error, succ) => {
// //         if (error) {
// //             console.error(`Error deploying Cloud Function: ${error}`);
// //             return;
// //         }
// //         console.log(`Cloud Function deployed successfully: ${succ}`);
// //     });
// }

