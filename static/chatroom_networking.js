var myID;
var _peer_list = {};

// socketio 
var protocol = window.location.protocol;
var socket = io(protocol + '//' + document.domain + ':' + location.port, {autoConnect: false});

document.addEventListener("DOMContentLoaded", (event)=>{
    startCamera();
});

var camera_allowed=false; 
var mediaConstraints = {
    audio: true, // We want an audio track
    video: {
        height: 360
    } // ...and we want a video track
};

function startCamera()
{
    navigator.mediaDevices.getUserMedia(mediaConstraints)
    .then((stream)=>{
        myVideo.srcObject = stream;
        camera_allowed = true;
        setAudioMuteState(audioMuted);                
        setVideoMuteState(videoMuted);
        //start the socketio connection
        socket.connect();
    })
    .catch((e)=>{
        console.log("getUserMedia Error! ", e);
        alert("Error! Unable to access camera or mic! ");
    });
}




socket.on("connect", ()=>{
    console.log("socket connected....");
    socket.emit("join-room", {"room_id": myRoomID});
});
socket.on("user-connect", (data)=>{
    console.log("user-connect ", data);
    let peer_id = data["sid"];
    let display_name = data["name"];
    _peer_list[peer_id] = undefined; // add new user to user list
    addVideoElement(peer_id, display_name);
});
socket.on("user-disconnect", (data)=>{
    console.log("user-disconnect ", data);
    let peer_id = data["sid"];
    delete _peer_list[peer_id]; // remove user from user list
    removeVideoElement(peer_id);
});
socket.on("user-list", (data)=>{
    console.log("user list recvd ", data);
    myID = data["my_id"];
    if( "list" in data) // not the first to connect to room, existing user list recieved
    {
        let recvd_list = data["list"];  
        // add existing users to user list
        for(peer_id in recvd_list)
        {
            display_name = recvd_list[peer_id];
            _peer_list[peer_id] = undefined;
            addVideoElement(peer_id, display_name);
        } 
        start_webrtc();
    }    
});

function log_user_list()
{
    for(let key in _peer_list)
    {
        console.log(`${key}: ${_peer_list[key]}`);
    }
}

//---------------[ webrtc ]--------------------    

var PC_CONFIG = {
    iceServers: [
        {
            urls: ['stun:stun.l.google.com:19302', 
                    'stun:stun1.l.google.com:19302',
                    'stun:stun2.l.google.com:19302',
                    'stun:stun3.l.google.com:19302',
                    'stun:stun4.l.google.com:19302'
                ]
        },
    ]
};

function log_error(e){console.log("[ERROR] ", e);}
function sendViaServer(data){socket.emit("data", data);}

socket.on("data", (msg)=>{
    switch(msg["type"])
    {
        case "offer":
            handleOfferMsg(msg);
            break;
        case "answer":
            handleAnswerMsg(msg);
            break;
        case "new-ice-candidate":
            handleNewICECandidateMsg(msg);
            break;
    }
});

function start_webrtc()
{
    // send offer to all other members
    for(let peer_id in _peer_list)
    {
        invite(peer_id);
    }
}

function invite(peer_id)
{
    if(_peer_list[peer_id]){console.log("[Not supposed to happen!] Attempting to start a connection that already exists!")}
    else if(peer_id === myID){console.log("[Not supposed to happen!] Trying to connect to self!");}
    else
    {
        console.log(`Creating peer connection for <${peer_id}> ...`);
        createPeerConnection(peer_id);

        let local_stream = myVideo.srcObject;
        local_stream.getTracks().forEach((track)=>{_peer_list[peer_id].addTrack(track, local_stream);});
    }
}

function createPeerConnection(peer_id)
{
    _peer_list[peer_id] = new RTCPeerConnection(PC_CONFIG);

    _peer_list[peer_id].onicecandidate = (event) => {handleICECandidateEvent(event, peer_id)};
    _peer_list[peer_id].ontrack = (event) => {handleTrackEvent(event, peer_id)};
    _peer_list[peer_id].onnegotiationneeded = () => {handleNegotiationNeededEvent(peer_id)};
}


function handleNegotiationNeededEvent(peer_id)
{
    _peer_list[peer_id].createOffer()
    .then((offer)=>{return _peer_list[peer_id].setLocalDescription(offer);})
    .then(()=>{
        console.log(`sending offer to <${peer_id}> ...`);
        sendViaServer({
            "sender_id": myID,
            "target_id": peer_id,
            "type": "offer",
            "sdp": _peer_list[peer_id].localDescription
        });
    })
    .catch(log_error);
} 

function handleOfferMsg(msg)
{   
    peer_id = msg['sender_id'];

    console.log(`offer recieved from <${peer_id}>`);
    
    createPeerConnection(peer_id);
    let desc = new RTCSessionDescription(msg['sdp']);
    _peer_list[peer_id].setRemoteDescription(desc)
    .then(()=>{
        let local_stream = myVideo.srcObject;
        local_stream.getTracks().forEach((track)=>{_peer_list[peer_id].addTrack(track, local_stream);});
    })
    .then(()=>{return _peer_list[peer_id].createAnswer();})
    .then((answer)=>{return _peer_list[peer_id].setLocalDescription(answer);})
    .then(()=>{
        sendViaServer({
            "sender_id": myID,
            "target_id": peer_id,
            "type": "answer",
            "sdp": _peer_list[peer_id].localDescription
        });
    })
    .catch(log_error);
}

function handleAnswerMsg(msg)
{
    peer_id = msg['sender_id'];
    console.log(`answer recieved from <${peer_id}>`);
    let desc = new RTCSessionDescription(msg['sdp']);
    _peer_list[peer_id].setRemoteDescription(desc)
}


function handleICECandidateEvent(event, peer_id)
{
    if(event.candidate){
        sendViaServer({
            "sender_id": myID,
            "target_id": peer_id,
            "type": "new-ice-candidate",
            "candidate": event.candidate
        });
    }
}

function handleNewICECandidateMsg(msg)
{
    var candidate = new RTCIceCandidate(msg.candidate);
    _peer_list[msg["sender_id"]].addIceCandidate(candidate)
    .catch(log_error);
}


function handleTrackEvent(event, peer_id)
{
    console.log(`track event recieved from <${peer_id}> : ${event}`);
    
    if(event.streams)
    {
        getVideoObj(peer_id).srcObject = event.streams[0];
    }
}