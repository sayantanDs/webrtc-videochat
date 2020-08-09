from flask import Flask, render_template, request, redirect, url_for
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__)
app.config['SECRET_KEY'] = "thisismys3cr3tk3y"

socketio = SocketIO(app)


_users_in_room = {} # stores room wise user list
_room_of_sid = {} # stores room joined by an used


@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        room_id = request.form['room_id']
        return redirect(url_for("enter_room", room_id=room_id))

    return render_template("home.html")

@app.route("/room/<string:room_id>/")
def enter_room(room_id):
    return render_template("chatroom.html", room_id=room_id)


@socketio.on("connect")
def on_connect():
    sid = request.sid
    print("New socket connected ", sid)
    

@socketio.on("join-room")
def on_join_room(data):
    sid = request.sid
    room_id = data["room_id"]
    
    # register sid to the room
    join_room(room_id)
    _room_of_sid[sid] = room_id
    
    # broadcast to others in the room
    print("["+ room_id +"] New socket joined ", sid)
    emit("user-connect", {"sid": sid}, broadcast=True, include_self=False, room=room_id)
    
    # add to user list maintained on server
    if room_id not in _users_in_room:
        _users_in_room[room_id] = [sid]
        emit("user-list", {"my_id": sid}) # send own id only
    else:
        emit("user-list", {"list": _users_in_room[room_id], "my_id": sid}) # send list of existing users to the new member
        _users_in_room[room_id].append(sid) # add new member to user list maintained on server

    print("\nusers: ", _users_in_room, "\n")


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    room_id = _room_of_sid[sid]

    print("["+ room_id +"] Socket disconnected ", sid)
    emit("user-disconnect", {"sid": sid}, broadcast=True, include_self=False, room=room_id)

    _users_in_room[room_id].remove(sid)
    if len(_users_in_room[room_id]) == 0:
        _users_in_room.pop(room_id)

    print("\nusers: ", _users_in_room, "\n")


@socketio.on("data")
def on_data(data):
    sender_sid = data['sender_id']
    target_sid = data['target_id']
    if sender_sid != request.sid:
        print("[Not supposed to happen!] request.sid and sender_id don't match!!!")

    if data["type"] != "new-ice-candidate":
        print('{} message from {} to {}'.format(data["type"], sender_sid, target_sid))
    socketio.emit('data', data, room=target_sid)

if __name__ == "__main__":
    socketio.run(app, debug=True)
