import React, { useState, useEffect } from 'react';
import axios from 'axios';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import io from 'socket.io-client';

// Dynamically set the server URL
const SERVER_URL = 'https://188.161.20.201:5000';
const socket = io(SERVER_URL);


const App = () => {
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState(null);
  const [user, setUser] = useState(null);
  const [players, setPlayers] = useState([]);
  const [currentWord, setCurrentWord] = useState(null);
  const [impostorId, setImpostorId] = useState(null);
  const [stage, setStage] = useState('waiting'); // waiting, asking, voting, results
  const [currentQuestioner, setCurrentQuestioner] = useState(null);
  const [readyPlayers, setReadyPlayers] = useState([]);
  const [votes, setVotes] = useState({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [hasVoted, setHasVoted] = useState(false);

  useEffect(() => {
    // Fetch last session data
    const fetchLastSession = async () => {
      const storedName = localStorage.getItem('name');
      if (storedName) {
        try {
          const response = await axios.get(`${SERVER_URL}/api/player/${storedName}`);
          setUser(response.data.player);
        } catch (error) {
          console.error('Error fetching last session:', error);
        }
      }
    };
    fetchLastSession();
  }, []);

  useEffect(() => {
    // Listen for real-time updates from the server
    socket.on('game-state-update', (data) => {
      const sortedPlayers = [...data.players].sort((a, b) => a.id.localeCompare(b.id));
      setPlayers(sortedPlayers);
      setCurrentWord(data.currentWord);
      setImpostorId(data.impostorId);
      setStage(data.stage);
      setCurrentQuestioner(data.currentQuestioner);
      setReadyPlayers(data.readyPlayers);
      setVotes(data.votes);
      setCurrentQuestionIndex(data.currentQuestionIndex);
      if (data.stage !== 'voting') {
        setHasVoted(false);
      }
      if (user) {
        const updatedUser = sortedPlayers.find((p) => p.id === user.id);
        if (updatedUser) {
          setUser(updatedUser);
        }
      }
    });

    return () => {
      socket.off('game-state-update');
    };
  }, [user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('name', name);
    formData.append('photo', photo);
    try {
      const response = await axios.post(`${SERVER_URL}/api/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 10000, // 10 seconds
      })
      ;
      setUser(response.data.player);
      localStorage.setItem('name', name);
    } catch (error) {
      console.error('Error uploading data:', error);
      alert('Failed to register. Please try again.');
    }
  };

  const markReady = async () => {
    try {
      await axios.post(`${SERVER_URL}/api/ready`, { playerId: user.id });
    } catch (error) {
      console.error('Error marking ready:', error);
      alert('Failed to mark as ready. Please try again.');
    }
  };

  const nextStage = async () => {
    try {
      await axios.post(`${SERVER_URL}/api/next-stage`);
    } catch (error) {
      console.error('Error moving to next stage:', error);
      alert('Failed to move to the next stage. Please try again.');
    }
  };

  const vote = async (votedPlayerId) => {
    try {
      await axios.post(`${SERVER_URL}/api/vote`, {
        voterId: user.id,
        votedPlayerId,
      });
      setHasVoted(true);
    } catch (error) {
      console.error('Error voting:', error);
      alert('Failed to vote. Please try again.');
    }
  };

  if (!user) {
    return (
      <RegisterContainer>
        <h1>برا السالفة</h1>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Your Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setPhoto(e.target.files[0])}
            required
          />
          <button type="submit">Join Game</button>
        </form>
      </RegisterContainer>
    );
  }

  const getPosition = (index) => {
    const angle = (2 * Math.PI * index) / players.length;
    return {
      x: Math.cos(angle) * 150,
      y: Math.sin(angle) * 150,
    };
  };

  return (
    <MainContainer>
      {/* Scoreboard */}
      <Scoreboard>
        <h3>لائحة النقاط</h3>
        {players.map((player) => (
          <p key={player.id}>
            {player.name}: {player.score} نقاط
          </p>
        ))}
      </Scoreboard>

      <Header>
        <h1>يا مرحب, {user.name}!</h1>
        {stage === 'waiting' && (
          <>
            <p>...ننتظر بالنشامة</p>
            <button onClick={markReady} disabled={readyPlayers.includes(user.id)}>
              {readyPlayers.includes(user.id) ? '!تم' : 'جاهز'}
            </button>
          </>
        )}
      </Header>

      <GameTable>
        {players.map((player, index) => {
          const pos = getPosition(index);
          const isCurrentQuestioner = currentQuestioner && player.id === currentQuestioner.id;
          const isBeingAsked =
            stage === 'asking' &&
            player.id === players[(currentQuestionIndex + 1) % players.length]?.id;
          const isReady = readyPlayers.includes(player.id);
          const playerVotes = votes[player.id];
          return (
            <PlayerBubble
              key={player.id}
              style={{
                transform: `translate(${pos.x}px, ${pos.y}px)`,
              }}
            >
              <UserAvatar
                isCurrentQuestioner={isCurrentQuestioner}
                isBeingAsked={isBeingAsked}
                isReady={isReady}
                highlight={player.highlight}
              >
                <img src={`${SERVER_URL}${player.photoUrl}`} alt={player.name} />
              </UserAvatar>
              <PlayerName>{player.name}</PlayerName>
              {stage === 'voting' && playerVotes && <VoteCount>{playerVotes.count} votes</VoteCount>}
            </PlayerBubble>
          );
        })}
      </GameTable>

      {stage === 'asking' && (
        <AskingSection>
          <h2>فقرة الاسئلة</h2>
          {currentQuestioner && currentQuestioner.id === user.id ? (
            <>
              <p>You are asking {players[(currentQuestionIndex + 1) % players.length]?.name}</p>
              <button onClick={nextStage}>I'm Done Asking</button>
            </>
          ) : (
            <p>
              Waiting for {currentQuestioner?.name} to finish asking...
              {players[(currentQuestionIndex + 1) % players.length]?.id === user.id && (
                <strong> You are being asked!</strong>
              )}
            </p>
          )}
        </AskingSection>
      )}

      {stage === 'voting' && (
        <VoteSection>
          <h2>فقرة التصويت</h2>
          {players
            .filter((player) => player.id !== user.id)
            .map((player) => (
              <button key={player.id} onClick={() => vote(player.id)} disabled={hasVoted}>
                Vote {player.name}
              </button>
            ))}
          {hasVoted && <p>.إنت صوتت</p>}
        </VoteSection>
      )}

      {stage === 'results' && (
        <ResultsSection>
          <h2>النتيجة</h2>
          <p>The impostor was: {players.find((p) => p.id === impostorId)?.name}</p>
          <button onClick={markReady}>الجولة الي بعدها</button>
        </ResultsSection>
      )}

      {(stage === 'asking' || stage === 'voting') && user.word && (
        <StoryPrompt>
          <p>{user.word === 'Impostor' ? '!أنت برا السالفة' : `الكلمة هي: ${user.word}`}</p>
        </StoryPrompt>
      )}
    </MainContainer>
  );
};

// Styled Components
const RegisterContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: linear-gradient(135deg, #6a11cb, #2575fc);
  color: white;
  font-family: 'Arial', sans-serif;
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    input {
      padding: 0.5rem;
      border: none;
      border-radius: 5px;
    }
    button {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 5px;
      background: #2575fc;
      color: white;
      cursor: pointer;
    }
  }
`;

const MainContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: linear-gradient(135deg, #6a11cb, #2575fc);
  color: white;
  font-family: 'Arial', sans-serif;
  position: relative;
`;

const Header = styled.div`
  text-align: center;
  margin-bottom: 2rem;
  h1 {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
  }
  p {
    font-size: 1.2rem;
    color: #e0e0e0;
  }
`;

const GameTable = styled.div`
  position: relative;
  width: 400px;
  height: 400px;
  border: 5px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  box-shadow: 0 0 20px rgba(0, 0, 0, 0.3);
`;

const PlayerBubble = styled.div`
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
`;

const UserAvatar = styled(motion.div)`
  width: 80px;
  height: 80px;
  border-radius: 50%;
  overflow: hidden;
  border: ${(props) => {
    if (props.highlight === 'ready') return '5px solid green';
    if (props.highlight === 'caught') return '5px solid red';
    if (props.highlight === 'winner') return '5px solid gold';
    if (props.isCurrentQuestioner) return '5px solid yellow';
    if (props.isBeingAsked) return '5px solid blue';
    if (props.isReady) return '5px solid green';
    return '3px solid white';
  }};
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.2), 0 10px 20px rgba(0, 0, 0, 0.3);
  transform: perspective(600px) rotateX(15deg);
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: perspective(600px) rotateX(15deg);
  }
`;

const PlayerName = styled.p`
  margin-top: 0.5rem;
  font-size: 0.8rem;
  color: white;
  text-align: center;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
`;

const VoteCount = styled.p`
  margin-top: 0.5rem;
  font-size: 0.8rem;
  color: yellow;
  text-align: center;
`;

const StoryPrompt = styled.div`
  background: rgba(255, 255, 255, 0.1);
  padding: 1rem;
  border-radius: 10px;
  margin-bottom: 1rem;
  text-align: center;
`;

const AskingSection = styled.div`
  background: rgba(255, 255, 255, 0.1);
  padding: 1rem;
  border-radius: 10px;
  margin-bottom: 1rem;
  text-align: center;
  button {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 5px;
    background: #2575fc;
    color: white;
    cursor: pointer;
  }
`;

const VoteSection = styled.div`
  background: rgba(255, 255, 255, 0.1);
  padding: 1rem;
  border-radius: 10px;
  margin-bottom: 1rem;
  text-align: center;
  button {
    margin: 0.5rem;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 5px;
    background: #2575fc;
    color: white;
    cursor: pointer;
  }
`;

const ResultsSection = styled.div`
  background: rgba(255, 255, 255, 0.1);
  padding: 1rem;
  border-radius: 10px;
  margin-bottom: 1rem;
  text-align: center;
  p {
    margin: 0.5rem 0;
  }
`;

const Scoreboard = styled.div`
  position: absolute;
  top: 1rem;
  left: 1rem;
  background: rgba(255, 255, 255, 0.1);
  padding: 1rem;
  border-radius: 10px;
  color: white;
`;

export default App;
